const asyncHandler = require("express-async-handler");
const Cart = require("../../models/cart.model");
const CartGiftProduct = require("../../models/cartGiftProduct.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerLogin = require("../../models/retailerLogin.model");
const GiftProduct = require("../../models/giftProduct.model");

const createCart = asyncHandler(async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        status: 400,
        message: "Products are required",
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

    // 4️⃣ Find existing active cart
    let cart = await Cart.findOne({
      retailer: retailerLogin._id,
      status: true,
    });

    // 5️⃣ Fetch gift products
    const productIds = products.map((p) => p.productId);
    const giftProducts = await GiftProduct.find({
      _id: { $in: productIds },
      status: "active",
    });

    if (giftProducts.length !== products.length) {
      return res.status(400).json({
        status: 400,
        message: "Some gift products are invalid",
      });
    }

    let addedQuantity = 0;
    let addedPoints = 0;
    const cartItems = [];

    // 6️⃣ Add / merge cart products
    for (const item of products) {
      const product = giftProducts.find(
        (p) => p._id.toString() === item.productId
      );

      const quantity = item.quantity || 1;
      const points = product.point * quantity;

      addedQuantity += quantity;
      addedPoints += points;

      const existingItem = cart
        ? await CartGiftProduct.findOne({
            cartId: cart._id,
            productId: product._id,
            status: true,
          })
        : null;

      if (existingItem) {
        existingItem.quantity += quantity;
        existingItem.points += points;
        await existingItem.save();
      } else {
        cartItems.push({
          retailer: retailerLogin._id,
          retatilerRealId: outletApprovedId,
          cartId: cart?._id, // temp
          productId: product._id,
          quantity,
          points,
          status: true,
        });
      }
    }

    // 7️⃣ Create cart if not exists
    if (!cart) {
      cart = await Cart.create({
        retailer: retailerLogin._id,
        retatilerRealId: outletApprovedId,
        totalQuantity: addedQuantity,
        totalPoints: addedPoints,
        status: true,
      });

      // attach cartId now
      cartItems.forEach((i) => (i.cartId = cart._id));
    } else {
      cart.totalQuantity += addedQuantity;
      cart.totalPoints += addedPoints;
      await cart.save();
    }

    // 8️⃣ Insert new cart items
    let giftOrders = [];
    if (cartItems.length > 0) {
      giftOrders = await CartGiftProduct.insertMany(cartItems);
    }

    return res.status(200).json({
      status: 200,
      message: "Cart updated successfully",
      data: {
        cart,
        giftOrders,
      },
    });
  } catch (error) {
    console.error("Error creating cart:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = createCart;
