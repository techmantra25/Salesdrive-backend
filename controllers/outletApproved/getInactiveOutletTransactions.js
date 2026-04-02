const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const Bill = require("../../models/bill.model");

const getInactiveOutletTransactions = asyncHandler(async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // ======================================================
    // 1️⃣ FIND Pending Orders from Inactive Outlets
    // ======================================================
    const pendingOrders = await OrderEntry.aggregate([
      {
        $match: {
          // status: { $in: ["Pending", "Completed_Billed", "Partially_Billed"] },
          status: "Pending",
          retailerId: { $exists: true },
          ...dateFilter,
        },
      },
      {
        $lookup: {
          from: "outletapproveds",
          localField: "retailerId",
          foreignField: "_id",
          as: "retailer",
        },
      },
      { $unwind: "$retailer" },
      {
        $match: {
          "retailer.status": false,
        },
      },
      {
        $project: {
          type: { $literal: "Order" },
          _id: 1,
          orderNo: 1,
          orderId: 1,
          status: 1,
          createdAt: 1,
          totalAmount: "$netAmount",

          retailer: {
            outletCode: "$retailer.outletCode",
            outletName: "$retailer.outletName",
            mobile: "$retailer.mobile1",
            status: "$retailer.status",
          },
        },
      },
    ]);

    // ======================================================
    // 2️⃣ FIND Pending Bills from Inactive Outlets
    // ======================================================
    const pendingBills = await Bill.aggregate([
      {
        $match: {
          // status: { $in: ["Pending", "Delivered"] },
          status: "Pending",
          retailerId: { $exists: true },
          ...dateFilter,
        },
      },
      {
        $lookup: {
          from: "outletapproveds",
          localField: "retailerId",
          foreignField: "_id",
          as: "retailer",
        },
      },
      { $unwind: "$retailer" },
      {
        $match: {
          "retailer.status": false,
        },
      },
      {
        $project: {
          type: { $literal: "Bill" },
          _id: 1,
          billNo: 1,
          orderId: 1,
          orderNo: 1,
          status: 1,
          createdAt: 1,
          invoiceAmount: 1,
          netAmount: 1,

          retailer: {
            outletCode: "$retailer.outletCode",
            outletName: "$retailer.outletName",
            mobile: "$retailer.mobile1",
            status: "$retailer.status",
          },
        },
      },
    ]);

    // ======================================================
    // 3️⃣ COMBINE Results
    // ======================================================
    const combinedResults = [...pendingOrders, ...pendingBills].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    // ======================================================
    // ✅ Response
    // ======================================================
    res.status(200).json({
      success: true,
      message: "Inactive outlet pending transactions fetched successfully",
      data: combinedResults,
      metadata: {
        pendingOrders: pendingOrders.length,
        pendingBills: pendingBills.length,
        totalRecords: combinedResults.length,
        outletStatus: "Inactive",
        orderStatus: "Pending",
        billStatus: "Pending",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching inactive outlet transactions:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
});

module.exports = {
  getInactiveOutletTransactions,
};
