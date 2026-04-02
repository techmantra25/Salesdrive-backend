const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Bill = require("../../models/bill.model");
const Invoice = require("../../models/invoice.model");

const allTransactionReport = asyncHandler(async (req, res) => {
  try {
    let {
      search,
      distributorId,
      transactionType,
      transactionFor,
      retailerId,
      status,
      fromDate,
      toDate,
    } = req.query;

    // Build filter object
    let filter = {};

    if (distributorId) {
      filter.distributorId = distributorId;
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      const orConditions = [];

      // Try to find bill and invoice
      const bill = await Bill.findOne({
        billNo: { $regex: search, $options: "i" },
      });
      if (bill) {
        orConditions.push({ billId: bill._id });
      }

      const invoice = await Invoice.findOne({
        invoiceNo: { $regex: search, $options: "i" },
      });
      if (invoice) {
        orConditions.push({ invoiceId: invoice._id });
      }

      // _id search (only if valid ObjectId)
      if (/^[a-f\d]{24}$/i.test(search)) {
        orConditions.push({ _id: search });
      }

      // remark search
      orConditions.push({ remark: searchRegex });

      if (orConditions.length) {
        filter.$or = orConditions;
      }
    }

    if (retailerId) {
      filter.retailerId = retailerId;
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

    // Prepare CSV headers for transaction
    const headers = [
      "Distributor Code",
      "Distributor Name",
      "Transaction Type",
      "Transaction For",
      "Points",
      "Status",
      "Retailer Name",
      "Retailer UID",
      "Invoice No",
      "Bill No",
      "Sales Return No",
      "Purchase Return No",
      "Remark",
      "Created At",
      "Updated At",
    ];

    const fileName = `all-transactions-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Fetch all transactions with filters
    const transactions = await DistributorTransaction.find(filter)
      .sort({ createdAt: -1 })
      .populate("distributorId")
      .populate("invoiceId")
      .populate("billId")
      .populate("retailerId")
      .populate("salesReturnId")
      .populate("purchaseReturnId");

    transactions.forEach((t) => {
      csvStream.write({
        "Distributor Code": t.distributorId?.dbCode || "",
        "Distributor Name": t.distributorId?.name || "",
        "Transaction Type": t.transactionType,
        "Transaction For": t.transactionFor,
        Points: t.transactionType === "credit" ? t.point : -t.point,
        Status: t.status,
        "Retailer Name": t.retailerId?.outletName || "",
        "Retailer UID": t.retailerId?.outletUID || "",
        "Invoice No": t.invoiceId?.invoiceNo || "",
        "Bill No": t.billId?.billNo || "",
        "Sales Return No": t.salesReturnId?.salesReturnNo || "",
        "Purchase Return No": t.purchaseReturnId?.code || "",
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
    console.error("All Transaction Report Error:", error.message);
    res.status(500).json({
      status: 500,
      message: "Failed to generate all transaction report",
      error: error.message,
    });
  }
});

module.exports = { allTransactionReport };
