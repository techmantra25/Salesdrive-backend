const asyncHandler = require("express-async-handler");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const Bill = require("../../models/bill.model");
const Invoice = require("../../models/invoice.model");
const OutletApproved = require("../../models/outletApproved.model");

const paginatedTransactionRetailer = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 20,
      search,
      distributorId,
      transactionType,
      transactionFor,
      retailerPhone,
      outletCode,
      status,
      fromDate,
      toDate,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        status: 400,
        message: "Page and limit should be positive integers",
      });
    }

    const skip = (page - 1) * limit;

    // 🔐 Retailer ID strictly from token
    const retailerId = req.user;

    if (!retailerId) {
      return res.status(401).json({
        status: 401,
        message: "Unauthorized: Retailer token required",
      });
    }

    // Base filter - LOCKED to token retailer
    let filter = {
      retailerId: retailerId,
    };

    // Distributor filter
    if (distributorId) {
      filter.distributorId = distributorId;
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, "i");
      const orConditions = [];

      const bill = await Bill.findOne({
        billNo: { $regex: search, $options: "i" },
      });
      if (bill) orConditions.push({ billId: bill._id });

      const invoice = await Invoice.findOne({
        invoiceNo: { $regex: search, $options: "i" },
      });
      if (invoice) orConditions.push({ invoiceId: invoice._id });

      if (/^[a-f\d]{24}$/i.test(search)) {
        orConditions.push({ _id: search });
      }

      orConditions.push({ transactionId: searchRegex });
      orConditions.push({ remark: searchRegex });

      if (orConditions.length) {
        filter.$or = orConditions;
      }
    }

    // Retailer phone / outlet code filter (still token-safe)
    if (retailerPhone || outletCode) {
      const outletQuery = {};

      if (retailerPhone) {
        const digits = retailerPhone.replace(/\D/g, "");
        outletQuery.mobile1 = { $regex: digits };
      }

      if (outletCode) {
        outletQuery.outletCode = outletCode;
      }

      const matchingOutlets = await OutletApproved.find(outletQuery).select(
        "_id"
      );

      const outletIds = matchingOutlets.map((o) => o._id);

      if (!outletIds.includes(retailerId)) {
        return res.status(200).json({
          status: 200,
          message:
            "Paginated retailer outlet transactions fetched successfully",
          data: [],
          pagination: {
            currentPage: page,
            limit,
            totalPages: 0,
            filteredCount: 0,
            totalCount: 0,
          },
        });
      }
    }

    // Other filters
    if (transactionType) filter.transactionType = transactionType;
    if (transactionFor) filter.transactionFor = transactionFor;
    if (status) filter.status = status;

    // Date filter (updatedAt)
    if (fromDate || toDate) {
      filter.updatedAt = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        filter.updatedAt.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filter.updatedAt.$lte = end;
      }
    }

    // Fetch data
    const transactions = await RetailerOutletTransaction.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ updatedAt: -1 })
      .populate("retailerId")
      .populate("distributorId")
      .populate("billId")
      .populate("salesReturnId")
      .populate("distributorTransactionId");

    const latestTransaction = await RetailerOutletTransaction.findOne({
      retailerId,
    }).sort({ updatedAt: -1 });

    const balance = latestTransaction ? latestTransaction.balance : 0;

    const totalCount = await RetailerOutletTransaction.countDocuments({
      retailerId,
    });
    const filteredCount = await RetailerOutletTransaction.countDocuments(
      filter
    );

    res.status(200).json({
      status: 200,
      message: "Paginated retailer outlet transactions fetched successfully",
      balance,
      data: transactions,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalCount,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: 400,
      message: error?.message || "Something went wrong",
    });
  }
});

module.exports = {paginatedTransactionRetailer };
