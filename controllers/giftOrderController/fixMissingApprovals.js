const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const OutletApproved = require("../../models/outletApproved.model");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");

/**
 * Fix a single gift order's approvals
 * Creates distributor approval requests for orders that have no approval records
 */
const fixSingleOrderApprovals = asyncHandler(async (req, res) => {
  try {
    const { orderId } = req.params;

    // Find the order by orderId field (not _id)
    const order = await GiftOrder.findOne({ orderId: orderId });

    if (!order) {
      return res.status(404).json({
        status: 404,
        message: "Gift order not found",
      });
    }

    // Check if approval already exists
    const existingApprovals = await DistributorGiftApproval.find({
      giftOrderId: order._id,
    });

    if (existingApprovals.length > 0) {
      return res.status(400).json({
        status: 400,
        message: "Approvals already exist for this order",
        data: {
          orderId: order.orderId,
          existingApprovals: existingApprovals.length,
          approvals: existingApprovals,
        },
      });
    }

    // Validate retatilerRealId
    if (!order.retatilerRealId) {
      return res.status(400).json({
        status: 400,
        message: "Order has no retailer mapping (retatilerRealId is missing)",
        data: {
          orderId: order.orderId,
        },
      });
    }

    // Get distributors from beat mapping
    const outlet = await OutletApproved.findById(order.retatilerRealId).populate({
      path: "beatId",
      populate: { 
        path: "distributorId", 
        select: "name dbCode _id"
      },
    });

    if (!outlet) {
      return res.status(404).json({
        status: 404,
        message: "Retailer not found for this order. The retatilerRealId may be invalid.",
        data: {
          orderId: order.orderId,
          retatilerRealId: order.retatilerRealId,
        },
      });
    }

    if (!outlet?.beatId) {
      return res.status(404).json({
        status: 404,
        message: "No beat/distributor mapping found for this order",
      });
    }

    const beats = Array.isArray(outlet.beatId)
      ? outlet.beatId
      : [outlet.beatId];

    const distributorMap = new Map();

    beats.forEach((beat) => {
      if (Array.isArray(beat?.distributorId)) {
        beat.distributorId.forEach((dist) => {
          if (dist?._id && dist?.name) {
            distributorMap.set(dist._id.toString(), dist);
          }
        });
      } else if (beat?.distributorId && beat.distributorId._id) {
        const dist = beat.distributorId;
        if (dist._id && dist.name) {
          distributorMap.set(dist._id.toString(), dist);
        }
      }
    });

    const distributors = Array.from(distributorMap.values());

    if (distributors.length === 0) {
      return res.status(404).json({
        status: 404,
        message: "No distributors found in beat mapping",
      });
    }

    // Split points equally among distributors
    const remainingPoints = order.totalRedemptionPoints;
    const pointsPerDistributor = Math.ceil(remainingPoints / distributors.length);

    const createdApprovals = [];

    for (let i = 0; i < distributors.length; i++) {
      const dist = distributors[i];
      const pointsToRequest = i === distributors.length - 1
        ? remainingPoints
        : Math.min(pointsPerDistributor, remainingPoints);

      if (pointsToRequest > 0) {
        const approval = await DistributorGiftApproval.create({
          giftOrderId: order._id,
          distributorId: dist._id,
          requestedPoints: pointsToRequest,
          status: "Pending",
          source: "beatMapping",
        });
        createdApprovals.push(approval);
      }
    }

    return res.status(200).json({
      status: 200,
      message: "Approvals created successfully",
      data: {
        orderId: order.orderId,
        approvalsCreated: createdApprovals.length,
        approvals: createdApprovals,
      },
    });
  } catch (error) {
    console.error("Error fixing order approvals:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = {
  fixSingleOrderApprovals,
};
