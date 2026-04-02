// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");
// const GiftProduct = require("../../models/giftProduct.model");
// const RetailerLogin = require("../../models/retailerLogin.model");
// const OutletApproved = require("../../models/outletApproved.model");
// const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");

// const removeGiftProductFromOrder = asyncHandler(async (req, res) => {
//   try {
//     const { id } = req.params; // gift order id
//     const { productId, quantity } = req.body;

//     if (!productId || !quantity) {
//       return res.status(400).json({
//         status: 400,
//         message: "Product ID and quantity are required",
//       });
//     }

//     // 1️⃣ Get retailer from token
//     const { retailerLoginId, outletApprovedId } = req.user;

//     // 2️⃣ Fetch approved retailer
//     const approvedRetailer = await OutletApproved.findById(outletApprovedId);

//     if (!approvedRetailer || !approvedRetailer.status) {
//       return res.status(400).json({
//         status: 400,
//         message: "Retailer not approved",
//       });
//     }

//     // 3️⃣ Validate login
//     const retailerLogin = await RetailerLogin.findById(retailerLoginId);

//     if (!retailerLogin) {
//       return res.status(400).json({
//         status: 400,
//         message: "Retailer not logged in",
//       });
//     }

//     // 4️⃣ Find order
//     const giftOrder = await GiftOrder.findById(id);

//     if (!giftOrder) {
//       return res.status(404).json({
//         status: 404,
//         message: "Gift order not found",
//       });
//     }

//     // 5️⃣ Only allow edit before NOC
//     if (giftOrder.status !== "Wating for NOC") {
//       return res.status(400).json({
//         status: 400,
//         message: "Order cannot be modified at this stage",
//       });
//     }

//     // 6️⃣ Find product in order
//     const orderProduct = giftOrder.products.find(
//       p => p.product.toString() === productId
//     );

//     if (!orderProduct) {
//       return res.status(400).json({
//         status: 400,
//         message: "Product not found in order",
//       });
//     }

//     // 7️⃣ Get product points
//     const giftProduct = await GiftProduct.findById(productId);

//     if (!giftProduct) {
//       return res.status(400).json({
//         status: 400,
//         message: "Gift product not found",
//       });
//     }

//     // 8️⃣ Calculate refund points
//     const removeQty = Math.min(quantity, orderProduct.quantity);
//     const refundPoints = giftProduct.point * removeQty;

//     // 9️⃣ Update product quantity / remove
//     orderProduct.quantity -= removeQty;

//     if (orderProduct.quantity <= 0) {
//       giftOrder.products = giftOrder.products.filter(
//         p => p.product.toString() !== productId
//       );
//     }

//     // 🔁 Recalculate total points
//     giftOrder.totalRedemptionPoints -= refundPoints;

    
//     // 11️⃣ Refund points to retailer
//     approvedRetailer.currentPointBalance += refundPoints;
//     await approvedRetailer.save();

//     // 12️⃣ Save order
//     await giftOrder.save();

//     // 12️⃣ Create retailer outlet transaction
//     const retailerOutletTransaction = await RetailerOutletTransaction.create({
//       retailerId: outletApprovedId,
//       giftRedemptionId: giftOrder._id,
//       transactionId: await transactionCode("RTO"),
//       transactionType: "debit",
//       transactionFor: "Order Cancellation",
//       point: refundPoints,
//       balance: approvedRetailer.currentPointBalance,
//       status: "Success",
//       remark: `Points refunded for Gift Order no ${giftOrder.orderId} for Retailer UID ${approvedRetailer.outletUID} and DB Code ${req.user.dbCode}`,
//     });

//     return res.status(200).json({
//       status: 200,
//       message: "Product removed from order successfully",
//       data: {
//         giftOrder,
//         refundedPoints: refundPoints,
//         remainingPoints: approvedRetailer.currentPointBalance,
//       },
//     });

//   } catch (error) {
//     console.error("Error removing product from order:", error);
//     return res.status(500).json({
//       status: 500,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// });

// module.exports = removeGiftProductFromOrder;


const asyncHandler = require("express-async-handler");

const removeGiftProductFromOrder = asyncHandler(async (req, res) => {
  return res.status(403).json({
    status: 403,
    message: "Remove product from order is not allowed",
  });
});

module.exports = removeGiftProductFromOrder;
