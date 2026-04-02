// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");
// const GiftProduct = require("../../models/giftProduct.model");
// const RetailerLogin = require("../../models/retailerLogin.model");
// const OutletApproved = require("../../models/outletApproved.model");
// const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
// const {giftOrderCodegerator, transactionCode} = require("../../utils/codeGenerator");

// const createGiftOrder = asyncHandler(async (req, res) => {
//   try {
//     const { products } = req.body;

//     if (!products || !Array.isArray(products) || products.length === 0) {
//       return res.status(400).json({
//         status: 400,
//         message: "Products are required",
//       });
//     }

//     // 1️⃣ Get retailer from token
//     const outletApprovedId = req.user;

//     // 2️⃣ Fetch approved retailer
//     const approvedRetailer = await OutletApproved.findById(outletApprovedId);
//     console.log(approvedRetailer);

//     // if (!approvedRetailer || !approvedRetailer.status) {
//     //   return res.status(400).json({
//     //     status: 400,
//     //     message: "Retailer not approved",
//     //   });
//     // }

//     // // 3️⃣ Validate login record
//     const retailerLogin = await RetailerLogin.findOne({
//       outletApprovedId: outletApprovedId,
//       status: true,
//     });

//     console.log(retailerLogin);

//     // if (!retailerLogin) {
//     //   return res.status(400).json({
//     //     status: 400,
//     //     message: "Retailer not logged in",
//     //   });
//     // }

//     // 4️⃣ Get product IDs
//     const productIds = products.map((p) => p.productId);

//     // 5️⃣ Fetch gift products
//     const giftProducts = await GiftProduct.find({
//       _id: { $in: productIds },
//       status: "active",
//     });

//     if (giftProducts.length !== products.length) {
//       return res.status(400).json({
//         status: 400,
//         message: "Some gift products are invalid or inactive",
//       });
//     }

//     // 6️⃣ Calculate total points
//     let totalRedemptionPoints = 0;

//     const formattedProducts = products.map((item) => {
//       const product = giftProducts.find(
//         (p) => p._id.toString() === item.productId
//       );

//       const quantity = item.quantity || 1;
//       const productPoints = product.point * quantity;

//       totalRedemptionPoints += productPoints;

//       return {
//         product: product._id,
//         quantity,
//       };
//     });

//     // 7️⃣ Check balance
//     if (approvedRetailer.currentPointBalance < totalRedemptionPoints) {
//       return res.status(400).json({
//         status: 400,
//         message: "Insufficient points balance",
//       });
//     }

//     // 8️⃣ Deduct points
//     approvedRetailer.currentPointBalance -= totalRedemptionPoints;
//     await approvedRetailer.save();

//     const giftOrderNo = await giftOrderCodegerator();

//     // 9️⃣ Create order
//     const giftOrder = await GiftOrder.create({
//       retailer: retailerLogin._id,
//       retailerRealId: outletApprovedId,
//       orderId: giftOrderNo,
//       products: formattedProducts,
//       totalRedemptionPoints,
//       status: "Wating for NOC",
//     });

//     // 10️⃣ Create retailer outlet transaction
//     const retailerOutletTransaction = await RetailerOutletTransaction.create({
//       retailerId: outletApprovedId,
//       giftRedemptionId: giftOrder._id,
//       transactionId: await transactionCode("RTO"),
//       transactionType: "debit",
//       transactionFor: "Gift Redemption",
//       point: totalRedemptionPoints,
//       balance: approvedRetailer.currentPointBalance,
//       status: "Success",
//       remark: `Points deducted for Gift Order no ${giftOrderNo} for Retailer UID ${approvedRetailer.outletUID} and DB Code ${req.user.dbCode}`,
//     });

//     return res.status(200).json({
//       status: 200,
//       message: "Gift order created successfully",
//       data: {
//         giftOrder,
//         totalRedemptionPoints,
//         remainingPoints: approvedRetailer.currentPointBalance,
//       },
//     });
//   } catch (error) {
//     console.error("Error creating gift order:", error);
//     return res.status(500).json({
//       status: 500,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// });

// module.exports = createGiftOrder;

const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const Cart = require("../../models/cart.model");
const CartGiftProduct = require("../../models/cartGiftProduct.model");
const RetailerLogin = require("../../models/retailerLogin.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const {
  giftOrderCodegerator,
  transactionCode,
} = require("../../utils/codeGenerator");

const createGiftOrder = asyncHandler(async (req, res) => {
  try {
    // 1️⃣ Retailer from token
    const outletApprovedId = req.user;

    // 2️⃣ Approved retailer
    const approvedRetailer = await OutletApproved.findById(outletApprovedId);
    if (!approvedRetailer) {
      return res.status(404).json({
        status: 404,
        message: "Retailer not found",
      });
    }

    // 3️⃣ Retailer login
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

    // 4️⃣ Active cart
    const cart = await Cart.findOne({
      retailer: retailerLogin._id,
      status: true,
    });

    if (!cart || cart.totalQuantity === 0) {
      return res.status(400).json({
        status: 400,
        message: "Cart is empty",
      });
    }

    // 5️⃣ Fetch cart items
    const cartItems = await CartGiftProduct.find({
      cartId: cart._id,
      status: true,
    }).populate("productId");

    if (!cartItems.length) {
      return res.status(400).json({
        status: 400,
        message: "No cart items found",
      });
    }

    // 6️⃣ Shipping info from request
    const {
      shipping_address,
      shipping_landmark,
      shipping_city,
      shipping_state,
      shipping_country,
      shipping_pin,
    } = req.body;

    if (
      !shipping_address ||
      !shipping_city ||
      !shipping_state ||
      !shipping_country ||
      !shipping_pin
    ) {
      return res.status(400).json({
        status: 400,
        message: "Complete shipping address is required",
      });
    }

    // 7️⃣ Check points balance
    if (approvedRetailer.currentPointBalance < cart.totalPoints) {
      return res.status(400).json({
        status: 400,
        message: `Insufficient points. Required: ${cart.totalPoints}, Available: ${approvedRetailer.currentPointBalance}.`,
      });
    }

    // 8️⃣ Prepare order items SNAPSHOT
    const orderItems = cartItems.map((item) => ({
      cartItemId: item._id,
      productId: item.productId._id,
      productName: item.productId.name,
      productImage: item.productId.image || [],
      pointsPerUnit: item.points / item.quantity,
      quantity: item.quantity,
      totalPoints: item.points,
    }));

    // 9️⃣ Deduct points
    approvedRetailer.currentPointBalance -= cart.totalPoints;
    await approvedRetailer.save();

    const giftOrderNo = await giftOrderCodegerator();

    // 🔟 Create Gift Order
    const giftOrder = await GiftOrder.create({
      retailer: retailerLogin._id,
      retatilerRealId: outletApprovedId,
      orderId: giftOrderNo,
      cartId: cart._id,
      orderItems,
      totalQuantity: cart.totalQuantity,
      totalRedemptionPoints: cart.totalPoints,
      status: "Waiting for NOC",

      // ✅ Shipping info snapshot
      shippingInfo: {
        userId: retailerLogin._id,
        shippingAddress: shipping_address,
        shippingLandmark: shipping_landmark,
        shippingCity: shipping_city,
        shippingState: shipping_state,
        shippingCountry: shipping_country,
        shippingPin: shipping_pin,
      },
    });

    // 1️⃣1️⃣ Create transaction entry
    await RetailerOutletTransaction.create({
      retailerId: outletApprovedId,
      giftRedemptionId: giftOrder._id,
      transactionId: await transactionCode("RTO"),
      transactionType: "debit",
      transactionFor: "Gift Redemption",
      point: cart.totalPoints,
      balance: approvedRetailer.currentPointBalance,
      status: "Success",
      remark: `Points deducted for Gift Order ${giftOrderNo}`,
    });

    // 1️⃣2️⃣ Clear cart
    await CartGiftProduct.updateMany(
      { cartId: cart._id },
      { $set: { status: false } }
    );

    cart.status = false;
    await cart.save();

    return res.status(200).json({
      status: 200,
      message: "Gift order created successfully",
      data: {
        giftOrder,
        totalRedemptionPoints: cart.totalPoints,
        remainingPoints: approvedRetailer.currentPointBalance,
      },
    });
  } catch (error) {
    console.error("Error creating gift order:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = createGiftOrder;
