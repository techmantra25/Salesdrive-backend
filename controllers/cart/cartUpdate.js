const asyncHandler = require("express-async-handler");
const Cart = require("../../models/cart.model");
const CartGiftProduct = require("../../models/cartGiftProduct.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerLogin = require("../../models/retailerLogin.model");

const cartUpdate = asyncHandler(async (req, res) => {
  try {
    const { cartItemId, quantity } = req.body;

    if (!cartItemId || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        status: 400,
        message: "Valid cartItemId and quantity are required",
      });
    }

    // 1️⃣ Retailer ID from token
    const outletApprovedId = req.user;

    // 2️⃣ Fetch approved retailer
    const approvedRetailer = await OutletApproved.findById(outletApprovedId);
    if (!approvedRetailer) {
      return res.status(404).json({
        status: 404,
        message: "Retailer not found",
      });
    }

    // 3️⃣ Validate login
    const retailerLogin = await RetailerLogin.findOne({
      outletApprovedId,
      status: true,
    });

    if (!retailerLogin) {
      return res.status(401).json({
        status: 401,
        message: "Retailer not logged in",
      });
    }

    // 4️⃣ Get active cart
    const cart = await Cart.findOne({
      retailer: retailerLogin._id,
      status: true,
    });

    if (!cart) {
      return res.status(404).json({
        status: 404,
        message: "Active cart not found",
      });
    }

    // 5️⃣ Get cart item
    const cartItem = await CartGiftProduct.findOne({
      _id: cartItemId,
      cartId: cart._id,
      status: true,
    });

    if (!cartItem) {
      return res.status(404).json({
        status: 404,
        message: "Cart item not found",
      });
    }

    // 6️⃣ Calculate new points
    const singleItemPoints = cartItem.points / cartItem.quantity;
    const newPoints = singleItemPoints * quantity;
    const quantityDiff = quantity - cartItem.quantity;
    const pointsDiff = newPoints - cartItem.points;

    // 7️⃣ Update cart item
    cartItem.quantity = quantity;
    cartItem.points = newPoints;
    await cartItem.save();

    // 8️⃣ Update cart totals
    cart.totalQuantity += quantityDiff;
    cart.totalPoints += pointsDiff;
    await cart.save();

    return res.status(200).json({
      status: 200,
      message: "Cart item updated successfully",
      data: {
        cartItemId,
        quantity,
        points: newPoints,
      },
    });
  } catch (error) {
    console.error("Error updating cart item:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = cartUpdate;
