const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const { transactionCode } = require("../../utils/codeGenerator");

const cancelGiftOrder = asyncHandler(async (req, res) => {
  console.log("Cancel order called", req.user, req.params);
  const { orderId } = req.params;
  const { reason } = req.body;

  // 1️⃣ Fetch order
  const giftOrder = await GiftOrder.findById(orderId);

  if (!giftOrder) {
    return res.status(404).json({
      status: 404,
      message: "Gift order not found",
    });
  }

  // 2️⃣ Fetch retailer
  const retailer = await OutletApproved.findById(giftOrder.retatilerRealId);

  if (!retailer) {
    return res.status(404).json({
      status: 404,
      message: "Retailer not found",
    });
  }

  const refundPoints = giftOrder.totalRedemptionPoints;

  // 4️⃣ Refund points
  retailer.currentPointBalance += refundPoints;
  await retailer.save();

  // 5️⃣ Update order
  giftOrder.status = "Cancelled";
  giftOrder.statusHistory.push({
    status: "Cancelled",
    remark: reason || "Order cancelled and points refunded",
  });
  giftOrder.cancellationInfo = {
    cancelledAt: new Date(),
    reason: reason || "Order cancelled by Admin",
  };
  await giftOrder.save();

  // 6️⃣ Create transaction (CREDIT)
  await RetailerOutletTransaction.create({
    retailerId: giftOrder.retatilerRealId,
    giftRedemptionId: giftOrder._id,
    transactionId: await transactionCode("RTO"),
    transactionType: "credit",
    transactionFor: "Gift Order Cancellation",
    point: refundPoints,
    balance: retailer.currentPointBalance,
    status: "Success",
    remark: `Refund for cancelled Gift Order ${giftOrder.orderId}`,
  });

  return res.status(200).json({
    status: 200,
    message: "Gift order cancelled and points refunded successfully",
    data: {
      orderId: giftOrder.orderId,
      refundedPoints: refundPoints,
      currentBalance: retailer.currentPointBalance,
    },
  });
});

module.exports = cancelGiftOrder;
