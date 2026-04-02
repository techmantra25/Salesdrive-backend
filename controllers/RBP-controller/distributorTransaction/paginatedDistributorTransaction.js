const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const Bill = require("../../../models/bill.model");
const Invoice = require("../../../models/invoice.model");
const OutletApproved = require("../../../models/outletApproved.model");

const paginatedDistributorTransaction = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search,
      distributorId,
      transactionType,
      transactionFor,
      retailerId,
      retailerPhone,
      outletCode,
      status,
      fromDate,
      toDate,
    } = req.query;

    // Convert query params to numbers and set default values hi hi
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    console.log("This route was hit");

    if (page < 1 || limit < 1) {
      res.status(400);
      throw new Error("Page and limit should be positive integers");
    }

    const skip = (page - 1) * limit;

    // Build the filter object
    let filter = {};

    // Distributor filter
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

      // Only add $or if there are conditions
      if (orConditions.length) {
        filter.$or = orConditions;
      }
    }

    // ----------------------------------
    // Retailer Phone & Outlet Code filter
    // ----------------------------------
    if (retailerPhone || outletCode) {
      const outletQuery = {};

      if (retailerPhone) {
        const digits = retailerPhone.replace(/\D/g, "");
        outletQuery.mobile1 = { $regex: digits };
      }

      if (outletCode) {
        outletQuery.outletCode = outletCode;
      }

      const matchingOutlets =
        await OutletApproved.find(outletQuery).select("_id");

      const outletIds = matchingOutlets.map((o) => o._id);

      // no match → empty result
      if (outletIds.length === 0) {
        return res.status(200).json({
          status: 200,
          message: "Paginated distributor transactions fetched successfully",
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

      filter.retailerId = { $in: outletIds };
    }

    // ----------------------------------
    // Retailer dropdown fallback (KEEP)
    // ----------------------------------
    if (!retailerPhone && !outletCode && retailerId) {
      filter.retailerId = retailerId;
    }

    // Transaction type filter
    if (transactionType) {
      filter.transactionType = transactionType;
    }

    // Transaction for filter
    if (transactionFor) {
      filter.transactionFor = transactionFor;
    }

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Date range filter on updatedAt field (changed from createdAt)
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

    // Fetch transactions with pagination and filter - sorted by updatedAt
    const transactions = await DistributorTransaction.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1, _id: -1 })// Changed from createdAt to updatedAt
      .populate({
        path: "distributorId",
        select: "",
      })
      .populate({
        path: "invoiceId",
        select: "",
      })
      .populate({
        path: "billId",
        select: "",
      })
      .populate({
        path: "retailerId",
        select: "",
      })
      .populate({
        path: "salesReturnId",
        select: "",
      })
      .populate({
        path: "purchaseReturnId",
        select: "",
      })
      .populate({
        path: "retailerOutletTransactionId",
        select: "transactionId",
      });

    const LatestTransaction = await DistributorTransaction.findOne({
      distributorId: distributorId,
    }).sort({ createdAt: -1, _id: -1 });

    const balance = LatestTransaction ? LatestTransaction.balance : 0;

    // Total count for all transactions
    const totalCount = await DistributorTransaction.countDocuments();

    // Total filtered count based on filters
    const filteredCount = await DistributorTransaction.countDocuments(filter);

    res.status(200).json({
      status: 200,
      message: "Paginated distributor transactions fetched successfully",
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
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedDistributorTransaction };
