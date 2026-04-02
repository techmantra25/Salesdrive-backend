const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");


/**
 * Get gift order details with distributor approvals
 * Access: Open (Admin / Retailer)
 */
const getGiftOrderApprovalDetails = asyncHandler(async (req, res) => {
  const { giftOrderId } = req.params;

  if (!giftOrderId) {
    return res.status(400).json({
      status: 400,
      message: "giftOrderId is required",
    });
  }

  // 1️⃣ Gift order
  const giftOrder = await GiftOrder.findById(giftOrderId)
    .populate("retailer", "name code")
    .lean();

  if (!giftOrder) {
    return res.status(404).json({
      status: 404,
      message: "Gift order not found",
    });
  }

  // 2️⃣ Distributor approvals
  const distributorApprovals = await DistributorGiftApproval.find({
    giftOrderId,
  })
    .populate("distributorId", "name code")
    .sort({ createdAt: 1 });

  return res.status(200).json({
    status: 200,
    message: "Gift order approval details fetched successfully",
    data: {
      giftOrder,
      distributorApprovals,
    },
  });
});

module.exports = getGiftOrderApprovalDetails;
