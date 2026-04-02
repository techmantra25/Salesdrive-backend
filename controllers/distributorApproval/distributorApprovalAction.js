const asyncHandler = require("express-async-handler");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");
const GiftOrder = require("../../models/giftOrder.model");
const OutletApproved = require("../../models/outletApproved.model");
const notificationQueue = require("../../queues/notificationQueue");
const ConfigureGiftOrderFlow = require("../../models/ConfigureGiftOrderFLow");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const { transactionCode } = require("../../utils/codeGenerator");

/**
 * Distributor approves or rejects gift redemption request
 * Points already deducted at SALES time
 */
const distributorApprovalAction = asyncHandler(async (req, res) => {
  const distributorId = req.user; // from distributor auth middleware
  const { approvalId, action, remark } = req.body;

  if (!approvalId || !["APPROVE", "REJECT"].includes(action)) {
    return res.status(400).json({
      status: 400,
      message: "approvalId and valid action (APPROVE / REJECT) are required",
    });
  }

  // 1️⃣ Fetch pending approval
  const approval = await DistributorGiftApproval.findOne({
    _id: approvalId,
    distributorId,
    status: "Pending",
  });

  if (!approval) {
    return res.status(404).json({
      status: 404,
      message: "Approval request not found or already processed",
    });
  }

  // 2️⃣ Fetch gift order
  const giftOrder = await GiftOrder.findById(approval.giftOrderId);
  if (!giftOrder) {
    return res.status(404).json({
      status: 404,
      message: "Gift order not found",
    });
  }

  // ✅ Fetch retailer info for notifications
  const approvedRetailer = await OutletApproved.findById(giftOrder.retatilerRealId);

  // 🔴 REJECT FLOW
  if (action === "REJECT") {
    // Check configuration for direct distributor cancel
    const config = await ConfigureGiftOrderFlow.findOne({});
    const directDistributorCancel = config?.settings?.directDistributorCancel || false;

    if (directDistributorCancel) {
      // Direct cancel flow - cancel the order and refund points
      const retailer = await OutletApproved.findById(giftOrder.retatilerRealId);

      if (!retailer) {
        return res.status(404).json({
          status: 404,
          message: "Retailer not found",
        });
      }

      const refundPoints = giftOrder.totalRedemptionPoints;

      // Refund points to retailer
      retailer.currentPointBalance += refundPoints;
      await retailer.save();

      // Update gift order to cancelled
      giftOrder.status = "Cancelled";
      giftOrder.statusHistory.push({
        status: "Cancelled",
        remark: remark || "Rejected by distributor - Direct cancel enabled",
      });
      giftOrder.cancellationInfo = {
        cancelledAt: new Date(),
        reason: remark || "Rejected by distributor",
      };
      await giftOrder.save();

      // Create transaction (CREDIT)
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

      // Update approval status
      approval.status = "Rejected";
      approval.remark = remark || "Rejected by distributor - Order cancelled";
      await approval.save();

      // 🔔 Send notification to admin
      const adminMessage = `Gift Order #${giftOrder.orderId} rejected by distributor - ${approvedRetailer?.outletName || "Unknown Retailer"}`;
      await notificationQueue.add("giftOrderAction", {
        type: "giftOrder",
        data: {
          message: adminMessage,
          orderId: giftOrder._id,
          approvalId: approval._id,
          title: "Gift Order Rejected",
          action: "REJECT",
        },
        room: "role:admin",
      });

      return res.status(200).json({
        status: 200,
        message: "Gift order cancelled and points refunded successfully",
        data: {
          orderId: giftOrder.orderId,
          refundedPoints: refundPoints,
          currentBalance: retailer.currentPointBalance,
          approvalStatus: approval.status,
        },
      });
    } else {
      // Standard reject flow - order remains in "Waiting for NOC"
      approval.status = "Rejected";
      approval.remark = remark || "Rejected by distributor";
      await approval.save();

      // 🔔 Send notification to admin
      const adminMessage = `Gift Order #${giftOrder.orderId} rejected by distributor - ${approvedRetailer?.outletName || "Unknown Retailer"}`;
      await notificationQueue.add("giftOrderAction", {
        type: "giftOrder",
        data: {
          message: adminMessage,
          orderId: giftOrder._id,
          approvalId: approval._id,
          title: "Gift Order Rejected",
          action: "REJECT",
        },
        room: "role:admin",
      });

      return res.status(200).json({
        status: 200,
        message: "Gift redemption request rejected successfully",
      });
    }
  }

  // 🟢 APPROVE FLOW
  approval.status = "Approved";
  approval.approvedPoints = approval.requestedPoints;
  approval.remark = remark || "Approved by distributor";
  await approval.save();

  // 3️⃣ Check if all distributor approvals are done
  const pendingApprovals = await DistributorGiftApproval.countDocuments({
    giftOrderId: giftOrder._id,
    status: "Pending",
  });

  if (pendingApprovals === 0) {
    giftOrder.status = "NOC Approved";
    giftOrder.statusHistory.push({
      status: "NOC Approved",
      remark: "All distributor approvals received",
    });
    await giftOrder.save();

    // 🔔 Send notification to admin only when all approvals are complete
    const adminMessage = `Gift Order #${giftOrder.orderId} from ${approvedRetailer?.outletName || "Unknown Retailer"} - All distributor approvals received, ready for processing`;
    await notificationQueue.add("giftOrderApprovalComplete", {
      type: "giftOrder",
      data: {
        message: adminMessage,
        orderId: giftOrder._id,
        approvalId: approval._id,
        title: "Gift Order Approved - Ready for Processing",
        action: "APPROVE",
      },
      room: "role:admin",
    });
  }

  return res.status(200).json({
    status: 200,
    message: "Distributor approval processed successfully",
    data: {
      approvalStatus: approval.status,
      giftOrderStatus: giftOrder.status,
    },
  });
});

module.exports = distributorApprovalAction;
