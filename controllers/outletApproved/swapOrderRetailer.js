const asyncHandler = require("express-async-handler");

const OrderEntry = require("../../models/orderEntry.model");
const Bill = require("../../models/bill.model");
const OutletApproved = require("../../models/outletApproved.model");

const swapOrderRetailer = asyncHandler(async (req, res) => {
  try {
    const { recordId, recordType } = req.body;

    // ==================================================
    // 1️⃣ Validation
    // ==================================================
    if (!recordId || !recordType) {
      return res.status(400).json({
        success: false,
        message: "recordId and recordType are required",
      });
    }

    let retailerId = null;
    let orderId = null;
    let sourceStatus = null;

    // ==================================================
    // 2️⃣ Identify Source Record
    // ==================================================
    if (recordType === "Order") {
      const order = await OrderEntry.findById(recordId).lean();

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // ✅ Allowed order statuses only
      const allowedStatuses = [
        "Pending",
        "Completed_Billed",
        "Partially_Billed",
      ];

      if (!allowedStatuses.includes(order.status)) {
        return res.status(400).json({
          success: false,
          message: `Order status "${order.status}" not eligible for swapping`,
        });
      }

      retailerId = order.retailerId;
      orderId = order._id;
      sourceStatus = order.status;
    }

    if (recordType === "Bill") {
      const bill = await Bill.findById(recordId).lean();

      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      // ✅ Only Pending bills can swap
      if (bill.status !== "Pending") {
        return res.status(400).json({
          success: false,
          message: `Bill status "${bill.status}" not eligible for swapping`,
        });
      }

      retailerId = bill.retailerId;
      orderId = bill.orderId;
      sourceStatus = bill.status;
    }

    if (!retailerId) {
      return res.status(400).json({
        success: false,
        message: "RetailerId not found in record",
      });
    }

    // ==================================================
    // 3️⃣ Find Inactive Outlet
    // ==================================================
    const inactiveOutlet = await OutletApproved.findById(retailerId).lean();

    if (!inactiveOutlet) {
      return res.status(404).json({
        success: false,
        message: "Inactive outlet not found",
      });
    }

    if (inactiveOutlet.status !== false) {
      return res.status(400).json({
        success: false,
        message: "Retailer is already active. Swap not required.",
      });
    }

    const mobile = inactiveOutlet.mobile1;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "Inactive outlet has no mobile number",
      });
    }

    // ==================================================
    // 4️⃣ Find Active Outlet Using Mobile
    // ==================================================
    const activeOutlet = await OutletApproved.findOne({
      mobile1: mobile,
      status: true,
    }).lean();

    if (!activeOutlet) {
      return res.status(404).json({
        success: false,
        message: `No active outlet found with mobile number ${mobile}`,
      });
    }

    if (
      !Array.isArray(activeOutlet.beatId) ||
      activeOutlet.beatId.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Active outlet does not have valid beatId",
      });
    }

    // ==================================================
    // 5️⃣ Perform Swap
    // ==================================================
    let orderUpdated = 0;
    let billsUpdated = 0;

    // ----------------------------
    // ✅ Swap Order + All Bills
    // ----------------------------
    if (recordType === "Order") {
      // Update Order
      const orderRes = await OrderEntry.updateOne(
        { _id: recordId },
        {
          $set: {
            retailerId: activeOutlet._id,
            routeId: activeOutlet.beatId[0],
          },
        },
      );

      orderUpdated = orderRes.modifiedCount;

      // Update Bills under this Order
      const billRes = await Bill.updateMany(
        { orderId: recordId },
        {
          $set: {
            retailerId: activeOutlet._id,
            routeId: activeOutlet.beatId[0],
          },
        },
      );

      billsUpdated = billRes.modifiedCount;
    }

    // ----------------------------
    // ✅ Swap Bill + Parent Order
    // ----------------------------
    if (recordType === "Bill") {
      // Update Bill
      const billRes = await Bill.updateOne(
        { _id: recordId },
        {
          $set: {
            retailerId: activeOutlet._id,
            routeId: activeOutlet.beatId[0],
          },
        },
      );

      billsUpdated = billRes.modifiedCount;

      // ✅ Also update parent OrderEntry
      const orderRes = await OrderEntry.updateOne(
        { _id: orderId },
        {
          $set: {
            retailerId: activeOutlet._id,
            routeId: activeOutlet.beatId[0],
          },
        },
      );

      orderUpdated = orderRes.modifiedCount;
    }

    // ==================================================
    // ✅ Final Response
    // ==================================================
    return res.status(200).json({
      success: true,
      message: "Swap completed successfully",
      data: {
        recordType,
        recordId,
        sourceStatus,
        inactiveOutlet: {
          outletName: inactiveOutlet.outletName,
          mobile: inactiveOutlet.mobile1,
        },
        activeOutlet: {
          outletName: activeOutlet.outletName,
          outletCode: activeOutlet.outletCode,
        },
        orderUpdated,
        billsUpdated,
      },
    });
  } catch (error) {
    console.error("Swap Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
});

module.exports = {
  swapOrderRetailer,
};
