const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const mongoose = require("mongoose");
const OrderEntry = require("../../models/orderEntry.model");
const Bill = require("../../models/bill.model");
const PurchaseOrderEntry = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Inventory = require("../../models/inventory.model");

const distributorDashboardCount = asyncHandler(async (req, res) => {
  const { distributorId } = req.query;
  try {
    if (!distributorId) {
      return res.status(400).json({
        status: 400,
        message: "Distributor ID is required",
      });
    }

    // Set timezone to Asia/Kolkata
    const TIMEZONE = "Asia/Kolkata";

    // Get current date ranges
    const today = moment().tz(TIMEZONE).startOf("day");
    const todayEnd = moment().tz(TIMEZONE).endOf("day");
    const monthStart = moment().tz(TIMEZONE).startOf("month");
    const monthEnd = moment().tz(TIMEZONE).endOf("month");

    // 1. Fetch total pending orders from sfa for this month for the distributor
    const totalPendingOrders = await OrderEntry.countDocuments({
      distributorId: distributorId,
      status: "Pending",
      orderSource: "SFA",
      createdAt: {
        $gte: monthStart.toDate(),
        $lte: monthEnd.toDate(),
      },
    });

    // 2. Fetch total orders for current month
    const currentMonthOrders = await OrderEntry.countDocuments({
      distributorId: distributorId,
      createdAt: {
        $gte: monthStart.toDate(),
        $lte: monthEnd.toDate(),
      },
    });

    // 3. Fetch current months all bills total amount (excluding cancelled bills)
    const allBillsAggregate = await Bill.aggregate([
      {
        $match: {
          distributorId: new mongoose.Types.ObjectId(distributorId),
          status: { $ne: "Cancelled" },
          createdAt: {
            $gte: monthStart.toDate(),
            $lte: monthEnd.toDate(),
          },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$netAmount" },
        },
      },
    ]);
    const totalBillsAmount = allBillsAggregate[0]?.totalAmount || 0;

    // 4. Fetch today's bills total amount (excluding cancelled bills)
    const todayBillsAggregate = await Bill.aggregate([
      {
        $match: {
          distributorId: new mongoose.Types.ObjectId(distributorId),
          status: { $ne: "Cancelled" },
          createdAt: {
            $gte: today.toDate(),
            $lte: todayEnd.toDate(),
          },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$netAmount" },
        },
      },
    ]);
    const todayBillsAmount = todayBillsAggregate[0]?.totalAmount || 0;

    // 5. Total purchase orders amount of current month (Confirmed invoices)
    const confirmedInvoicesAggregate = await Invoice.aggregate([
      {
        $match: {
          distributorId: new mongoose.Types.ObjectId(distributorId),
          status: "Confirmed",
          date: {
            $gte: monthStart.toDate(),
            $lte: monthEnd.toDate(),
          },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$totalInvoiceAmount" },
        },
      },
    ]);

    const totalConfirmedInvoicesAmount =
      confirmedInvoicesAggregate[0]?.totalAmount || 0;
    const totalPurchaseAmount = totalConfirmedInvoicesAmount;

    // Get unique retailer counts from orders
    const uniqueOrderRetailersCount = await OrderEntry.aggregate([
      {
        $match: {
          distributorId: new mongoose.Types.ObjectId(distributorId),
          createdAt: {
            $gte: monthStart.toDate(),
            $lte: monthEnd.toDate(),
          },
        },
      },
      {
        $group: {
          _id: "$retailerId",
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
        },
      },
    ]);

    // Get unique retailer counts from bills
    const uniqueBillRetailersCount = await Bill.aggregate([
      {
        $match: {
          distributorId: new mongoose.Types.ObjectId(distributorId),
          status: { $ne: "Cancelled" },
        },
      },
      {
        $group: {
          _id: "$retailerId",
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
        },
      },
    ]);

    // Get inventory stats with unique product count
    const inventoryStats = await Inventory.aggregate([
      {
        $match: {
          distributorId: new mongoose.Types.ObjectId(distributorId),
        },
      },
      {
        $group: {
          _id: null,
          totalAvailableQty: { $sum: "$availableQty" },
          totalStockValue: { $sum: "$totalStockamtDlp" },
          uniqueProducts: { $addToSet: "$productId" },
        },
      },
      {
        $project: {
          _id: 0,
          totalAvailableQty: 1,
          totalStockValue: 1,
          uniqueProductsCount: { $size: "$uniqueProducts" },
        },
      },
    ]);

    const stockStats = {
      totalAvailableQuantity: inventoryStats[0]?.totalAvailableQty || 0,
      totalStockValue: inventoryStats[0]?.totalStockValue || 0,
      uniqueProductsCount: inventoryStats[0]?.uniqueProductsCount || 0,
    };

    return res.status(200).json({
      status: 200,
      message: "Distributor dashboard counts",
      data: {
        totalPendingOrders,
        currentMonthOrders,
        totalBillsAmount,
        todayBillsAmount,
        purchaseStats: {
          totalPurchaseAmount,
          confirmedInvoicesAmount: totalConfirmedInvoicesAmount,
        },
        uniqueRetailerStats: {
          uniqueOrderingRetailers: uniqueOrderRetailersCount[0]?.count || 0,
          uniqueBillingRetailers: uniqueBillRetailersCount[0]?.count || 0,
        },
        stockStats,
      },
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { distributorDashboardCount };
