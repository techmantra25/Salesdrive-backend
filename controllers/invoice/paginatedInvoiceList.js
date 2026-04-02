const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");

const paginatedInvoiceList = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      status,
      invoiceNo,
      fromDate,
      toDate,
      distributorId,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    // Build the filter object
    let filter = {};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Invoice number search
    if (invoiceNo) {
      filter.invoiceNo = { $regex: invoiceNo, $options: "i" }; // Case-insensitive regex search
    }

    // Distributor filter
    if (distributorId) {
      filter.distributorId = distributorId;
    }

    // Date range filter
    if (fromDate || toDate) {
      filter.date = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.date.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.date.$lte = endOfDay;
      }
    }

    // Fetch invoices with pagination and filter
    const invoices = await Invoice.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .populate({
        path: "distributorId",
        select: "",
      })
      .populate({
        path: "lineItems.product",
        select: "",
        populate: {
          path: "brand",
          select: "",
        },
      })
      .populate({
        path: "lineItems.plant",
        select: "",
      });

    const totalQuery = {};
    if (distributorId) {
      totalQuery.distributorId = distributorId;
    }
    // Total count for all invoices
    const totalCount = await Invoice.countDocuments(totalQuery);

    // Total filtered count based on filters
    const totalFilteredCount = await Invoice.countDocuments(filter);

    // Count of all active invoices (for extra insight)
    const totalActiveCount = await Invoice.countDocuments({
      status: "Confirmed",
    });

    // Respond with paginated data
    return res.status(200).json({
      status: 200,
      message: "Paginated invoice list",
      data: invoices,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalFilteredCount / limit),
        totalCount,
        filteredCount: totalFilteredCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedInvoiceList };
