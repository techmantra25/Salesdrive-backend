// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");

// const statusUpdate = asyncHandler(async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     if (!id || !status) {
//       return res.status(400).json({
//         status: 400,
//         message: "Gift order ID and status are required",
//       });
//     }

//     // Check if status is "Cancelled"
//     if (status === "Cancelled") {
//       return res.status(400).json({
//         status: 400,
//         message: "Cannot update status to Cancelled",
//       });
//     }

//     // 1️⃣ Find gift order
//     const giftOrder = await GiftOrder.findById(id);

//     if (!giftOrder) {
//       return res.status(404).json({
//         status: 404,
//         message: "Gift order not found",
//       });
//     }

//     // 2️⃣ Update status
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

// module.exports = statusUpdate;

// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");

// const statusUpdate = asyncHandler(async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     if (!id || !status) {
//       return res.status(400).json({
//         status: 400,
//         message: "Gift order ID and status are required",
//       });
//     }

//     // 1️⃣ Fetch order
//     const giftOrder = await GiftOrder.findById(id);
//     if (!giftOrder) {
//       return res.status(404).json({
//         status: 404,
//         message: "Gift order not found",
//       });
//     }

//     // 2️⃣ (Optional) Validate status value
//     const allowedStatuses = [
//       "NOC Approved",
//       "Address Confirmed",
//       "Gift Ordered",
//       "Gift Dispatched",
//       "Gift Delivered",
//     ];

//     if (!allowedStatuses.includes(status)) {
//       return res.status(400).json({
//         status: 400,
//         message: "Invalid order status",
//       });
//     }

//     // 3️⃣ Update status (admin override)
//     giftOrder.status = status;
//     await giftOrder.save();

//     return res.status(200).json({
//       status: 200,
//       message: "Gift order status updated successfully",
//       data: {
//         orderId: giftOrder.orderId,
//         previousStatus: giftOrder.status,
//         currentStatus: status,
//       },
//     });
//   } catch (error) {
//     console.error("Error updating gift order status:", error);
//     return res.status(500).json({
//       status: 500,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// });

// module.exports = statusUpdate;

const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const OutletApproved = require("../../models/outletApproved.model");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");
const Distributor = require("../../models/distributor.model");
const notificationQueue = require("../../queues/notificationQueue");
// const smsQueue = require("../../queues/smsQueue"); // Commented out - SMS queue disabled

const statusUpdate = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      docketNumber,
      dispatchDate,
      ExpecteddeliveryDate,
      dispatchRemark,
      deliveryDate,
      deliveryRemark,
      remark,
    } = req.body;

    if (!id || !status) {
      return res.status(400).json({
        status: 400,
        message: "Order ID and status are required",
      });
    }

    const giftOrder = await GiftOrder.findById(id);
    if (!giftOrder) {
      return res.status(404).json({
        status: 404,
        message: "Gift order not found",
      });
    }

    const previousStatus = giftOrder.status;

    const allowedStatuses = [
      "NOC Approved",
      "Address Confirmed",
      "Gift Ordered",
      "Gift Dispatched",
      "Gift Delivered",
      "Cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 400,
        message: "Invalid status",
      });
    }

    // 🔹 Gift Dispatched
    if (status === "Gift Dispatched") {
      if (!docketNumber || !dispatchDate || !dispatchRemark) {
        return res.status(400).json({
          status: 400,
          message:
            "Docket number, dispatch date and dispatch remark are required",
        });
      }

      giftOrder.dispatchInfo = {
        docketNumber,
        dispatchDate: new Date(dispatchDate),
        dispatchRemark,
        ExpecteddeliveryDate,
      };
    }

    // 🔹 Gift Delivered
    if (status === "Gift Delivered") {
      if (!deliveryDate || !deliveryRemark) {
        return res.status(400).json({
          status: 400,
          message: "Delivery date and delivery remark are required",
        });
      }

      giftOrder.deliveryInfo = {
        deliveryDate: new Date(deliveryDate),
        deliveryRemark,
      };
    }

    // 🔹 Cancelled
    if (status === "Cancelled") {
      if (!remark) {
        return res.status(400).json({
          status: 400,
          message: "Cancellation remark is required",
        });
      }

      giftOrder.cancellationInfo = {
        cancelledAt: new Date(),
        reason: remark,
      };
    }

    // 🔹 Update status
    giftOrder.status = status;

    // 🔹 Push timeline
    giftOrder.statusHistory.push({
      status,
      remark,
    });

    await giftOrder.save();

    // 🔔 Send notifications based on status
    try {
      // Fetch retailer info for notifications
      const approvedRetailer = await OutletApproved.findById(
        giftOrder.retatilerRealId,
      );
      const retailerName = approvedRetailer?.outletName || "Retailer";

      if (status === "Gift Dispatched") {
        // Retailer notification
        await notificationQueue.add("giftOrderDispatchedRetailer", {
          type: "giftOrder",
          data: {
            message: `Your Gift Order #${giftOrder.orderId} has been dispatched. Docket No: ${docketNumber}. Expected delivery: ${ExpecteddeliveryDate || "Soon"}`,
            orderId: giftOrder._id,
            title: "Order Dispatched",
            docketNumber,
          },
          userId: giftOrder.retatilerRealId,
          userType: "OutletApproved",
        });

        // SMS to retailer
        // await smsQueue.add("dispatchSMS", {
        //   contact: approvedRetailer?.mobile1,
        //   message: `Your Gift Order ${giftOrder.orderId} has been dispatched. Docket No: ${docketNumber}. Expected delivery: ${ExpecteddeliveryDate || "Soon"}.`,
        // });

        // 🔔 Notify Distributors
        const distributorApprovals = await DistributorGiftApproval.find({
          giftOrderId: giftOrder._id,
        }).populate("distributorId");

        for (const approval of distributorApprovals) {
          const distributor = await Distributor.findById(approval.distributorId);
          if (distributor) {
            await notificationQueue.add("giftOrderDispatchedDistributor", {
              type: "giftOrder",
              data: {
                message: `Gift Order #${giftOrder.orderId} from ${approvedRetailer?.outletName || "Retailer"} has been dispatched. Docket No: ${docketNumber}.`,
                orderId: giftOrder._id,
                title: "Order Dispatched",
                docketNumber,
              },
              userId: approval.distributorId,
              userType: "Distributor",
            });
          }
        }
      }

      if (status === "Gift Delivered") {
        // Retailer notification
        await notificationQueue.add("giftOrderDeliveredRetailer", {
          type: "giftOrder",
          data: {
            message: `Your Gift Order #${giftOrder.orderId} has been delivered successfully. Thank you for your order!`,
            orderId: giftOrder._id,
            title: "Order Delivered",
          },
          userId: giftOrder.retatilerRealId,
          userType: "OutletApproved",
        });
      }

      if (status === "Cancelled") {
        // Retailer notification
        await notificationQueue.add("giftOrderCancelledRetailer", {
          type: "giftOrder",
          data: {
            message: `Your Gift Order #${giftOrder.orderId} has been cancelled. Reason: ${remark}`,
            orderId: giftOrder._id,
            title: "Order Cancelled",
          },
          userId: giftOrder.retatilerRealId,
          userType: "OutletApproved",
        });
      }
    } catch (notifError) {
      console.error("❌ Failed to send notifications:", notifError.message);
    }

    return res.status(200).json({
      status: 200,
      message: "Status updated successfully",
      data: {
        orderId: giftOrder.orderId,
        previousStatus,
        currentStatus: status,
      },
    });
  } catch (error) {
    console.error("Status update error:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = statusUpdate;
