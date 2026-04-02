const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");

const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");
const Bill = require("../../models/bill.model");
const SalesReturn = require("../../models/salesReturn.model");
const GiftOrder = require("../../models/giftOrder.model");

/**
 * Download All Retailer Outlet Transaction Report
 * Generates a CSV report of all retailer outlet transactions
 */
const allRetailerOutletTransactionReport = asyncHandler(async (req, res) => {
  try {
    let {
      search,
      retailerId,
      distributorId,
      transactionType,
      transactionFor,
      status,
      fromDate,
      toDate,
    } = req.query;

    // Build filter object
    let filter = {};

    if (retailerId) {
      filter.retailerId = retailerId;
    }

    if (distributorId) {
      filter.distributorId = distributorId;
    }

    if (transactionType) {
      filter.transactionType = transactionType;
    }

    if (transactionFor) {
      filter.transactionFor = transactionFor;
    }

    if (status) {
      filter.status = status;
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      const orConditions = [];

      // Transaction ID search
      orConditions.push({ transactionId: searchRegex });

      // Remark search
      orConditions.push({ remark: searchRegex });

      // Try to find bill
      const bill = await Bill.findOne({
        billNo: { $regex: search, $options: "i" },
      });
      if (bill) {
        orConditions.push({ billId: bill._id });
      }

      // _id search (only if valid ObjectId)
      if (/^[a-f\d]{24}$/i.test(search)) {
        orConditions.push({ _id: search });
      }

      if (orConditions.length) {
        filter.$or = orConditions;
      }
    }

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }

    // Prepare CSV headers
    const headers = [
      "Transaction ID",
      "Transaction Type",
      "Transaction For",
      "Points",
      "Status",
      "Retailer Code",
      "Retailer Name",
      "DB Name",
      "DB Code",
      "Bill No",
      "Sales Return No",
      "Gift Order No",
      "Remark",
      "Created At",
      "Updated At",
    ];

    const fileName = `all-retailer-transactions-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Fetch all transactions with filters
    const transactions = await RetailerOutletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .populate("retailerId")
      .populate("distributorId")
      .populate("billId")
      .populate("salesReturnId")
      .populate("giftRedemptionId");

    transactions.forEach((t) => {
      csvStream.write({
        "Transaction ID": t.transactionId || "",
        "Transaction Type": t.transactionType || "",
        "Transaction For": t.transactionFor || "",
        Points: t.point || 0,
        Status: t.status || "",
        "Retailer Code": t.retailerId?.outletCode || "",
        "Retailer Name": t.retailerId?.outletName || "",
        "DB Name": t.distributorId?.name || "",
        "DB Code": t.distributorId?.dbCode || "",
        "Bill No": t.billId?.billNo || "",
        "Sales Return No": t.salesReturnId?.salesReturnNo || "",
        "Gift Order No": t.giftRedemptionId?.orderNo || "",
        Remark: t.remark || "",
        "Created At": moment(t.createdAt)
          .tz("Asia/Kolkata")
          .format("DD-MM-YYYY HH:mm:ss"),
        "Updated At": moment(t.updatedAt)
          .tz("Asia/Kolkata")
          .format("DD-MM-YYYY HH:mm:ss"),
      });
    });

    csvStream.end();
  } catch (error) {
    console.error("All Retailer Transaction Report Error:", error.message);
    res.status(500).json({
      status: 500,
      message: "Failed to generate all retailer transaction report",
      error: error.message,
    });
  }
});

module.exports = { allRetailerOutletTransactionReport };
