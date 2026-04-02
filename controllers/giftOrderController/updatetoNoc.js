// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");
// const OutletApproved = require("../../models/outletApproved.model");

// const updatetoNoc = asyncHandler(async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     if (!id || !status) {
//       return res.status(400).json({
//         status: 400,
//         message: "Gift order ID and status are required",
//       });
//     }

//     // 1️⃣ Get distributor from token
//     const { distributorId } = req.user;

//     // 2️⃣ Find gift order
//     const giftOrder = await GiftOrder.findById(id);

//     if (!giftOrder) {
//       return res.status(404).json({
//         status: 404,
//         message: "Gift order not found",
//       });
//     }

//     // 3️⃣ Find outlet linked to this order
//     const outlet = await OutletApproved.findOne({
//       _id: giftOrder.outletApprovedId,  // make sure this field exists in GiftOrder
//       distributorId: distributorId,     // 🔐 ownership check
//     });

//     if (!outlet) {
//       return res.status(403).json({
//         status: 403,
//         message: "You are not authorized to update this order",
//       });
//     }

//     // 4️⃣ Update status
//     giftOrder.status = status;
//     await giftOrder.save();

//     res.status(200).json({
//       status: 200,
//       message: "Gift order updated successfully",
//       data: {
//         giftOrder,
//       },
//     });

//   } catch (error) {
//     console.error("Error updating gift order status:", error);
//     res.status(500).json({
//       status: 500,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// });

// module.exports = updatetoNoc;


const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const OutletApproved = require("../../models/outletApproved.model");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const { transactionCode } = require("../../utils/codeGenerator");

const updatetoNoc = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
      return res.status(400).json({
        status: 400,
        message: "Gift order ID and status are required",
      });
    }

    const allowedStatuses = ["NOC Approved", "Cancelled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 400,
        message: "Invalid NOC status update",
      });
    }

    // 1️⃣ Distributor from token
    const { distributorId } = req.user;

    // 2️⃣ Fetch order
    const giftOrder = await GiftOrder.findById(id);
    if (!giftOrder) {
      return res.status(404).json({
        status: 404,
        message: "Gift order not found",
      });
    }

    // ❌ Already cancelled protection
    if (giftOrder.status === "Cancelled") {
      return res.status(400).json({
        status: 400,
        message: "Order already cancelled",
      });
    }

    // ❌ Status transition guard
    if (giftOrder.status !== "Waiting for NOC") {
      return res.status(400).json({
        status: 400,
        message: `Order cannot be updated from '${giftOrder.status}'`,
      });
    }

    // 3️⃣ Ownership check
    const outlet = await OutletApproved.findOne({
      _id: giftOrder.retatilerRealId,
      distributorId,
    });

    if (!outlet) {
      return res.status(403).json({
        status: 403,
        message: "Unauthorized to update this order",
      });
    }

    // 🔁 HANDLE CANCELLATION REFUND
    if (status === "Cancelled") {
      const refundPoints = giftOrder.totalRedemptionPoints;

      outlet.currentPointBalance += refundPoints;
      await outlet.save();

      await RetailerOutletTransaction.create({
        retailerId: outlet._id,
        giftRedemptionId: giftOrder._id,
        transactionId: await transactionCode("RTO"),
        transactionType: "credit",
        transactionFor: "Gift Order Cancellation",
        point: refundPoints,
        balance: outlet.currentPointBalance,
        status: "Success",
        remark: `Refund for cancelled gift order ${giftOrder.orderId} by distributor`,
      });
    }

    // 4️⃣ Update order status
    giftOrder.status = status;
    await giftOrder.save();

    return res.status(200).json({
      status: 200,
      message:
        status === "Cancelled"
          ? "Gift order cancelled and points refunded"
          : "Gift order NOC approved",
      data: {
        orderId: giftOrder.orderId,
        status: giftOrder.status,
      },
    });
  } catch (error) {
    console.error("Error updating NOC:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = updatetoNoc;
