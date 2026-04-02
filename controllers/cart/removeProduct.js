const asyncHandler = require("express-async-handler");
const Cart = require("../../models/cart.model");
const CartGiftProduct = require("../../models/cartGiftProduct.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerLogin = require("../../models/retailerLogin.model");

const removeProduct = asyncHandler(async (req, res) => {
  try {
    const { cartItemId } = req.body;

    if (!cartItemId) {
      return res.status(400).json({
        status: 400,
        message: "Cart item ID is required",
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

    // 4️⃣ Get ACTIVE cart
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

    // 5️⃣ Find cart item by cartItemId
    const removedItem = await CartGiftProduct.findOne({
      _id: cartItemId,
      cartId: cart._id,
      status: true,
    });

    if (!removedItem) {
      return res.status(404).json({
        status: 404,
        message: "Cart item not found",
      });
    }

    // 6️⃣ Remove cart item
    await CartGiftProduct.findByIdAndDelete(cartItemId);

    // 7️⃣ Update cart totals
    await Cart.findByIdAndUpdate(cart._id, {
      $inc: {
        totalQuantity: -removedItem.quantity,
        totalPoints: -removedItem.points,
      },
    });

    return res.status(200).json({
      status: 200,
      message: "Cart item removed successfully",
      data: {
        cartItemId,
        removedQuantity: removedItem.quantity,
        removedPoints: removedItem.points,
      },
    });
  } catch (error) {
    console.error("Error removing cart item:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = removeProduct;
