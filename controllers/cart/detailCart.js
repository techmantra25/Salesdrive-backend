const asyncHandler = require("express-async-handler");
const Cart = require("../../models/cart.model");
const CartGiftProduct = require("../../models/cartGiftProduct.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerLogin = require("../../models/retailerLogin.model");

const detailCart = asyncHandler(async (req, res) => {
  try {
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

    // 4️⃣ Get active cart ONLY
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

    // 5️⃣ Get cart items
    const cartItems = await CartGiftProduct.find({
      cartId: cart._id,
      status: true,
    }).populate("productId", "name image point");

    return res.status(200).json({
      status: 200,
      message: "Cart detail fetched successfully",
      data: {
        cart,
        cartItems,
        totalPoints: cart.totalPoints, // source of truth
      },
    });
  } catch (error) {
    console.error("Error fetching cart:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = detailCart;
