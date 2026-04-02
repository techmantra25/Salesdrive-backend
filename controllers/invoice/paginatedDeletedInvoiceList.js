const asyncHandler = require("express-async-handler");
const DeletedInvoice = require("../../models/deletedInvoice");

const paginatedDeletedInvoiceList = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
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

    // Invoice number search
    if (invoiceNo) {
      filter.invoiceNo = { $regex: invoiceNo, $options: "i" }; // Case-insensitive regex search
    }

    // Distributor filter
    if (distributorId) {
      filter.distributorId = distributorId;
    }

    // Date range filter for deletedAt
    if (fromDate || toDate) {
      filter.deletedAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.deletedAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.deletedAt.$lte = endOfDay;
      }
    }

    // Fetch deleted invoices with pagination and filter
    const deletedInvoices = await DeletedInvoice.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ deletedAt: -1 })
      .populate({
        path: "distributorId",
        select: "name code", // Assuming distributor has name and code
      })
      .populate({
        path: "deletedBy",
        select: "name email", // Assuming user has name and email
      });
     


    // Total count for all deleted invoices
    const totalCount = await DeletedInvoice.countDocuments();

    // Total filtered count based on filters
    const totalFilteredCount = await DeletedInvoice.countDocuments(filter);

    // Respond with paginated data
    return res.status(200).json({
      status: 200,
      message: "Paginated deleted invoice list",
      data: deletedInvoices,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalFilteredCount / limit),
        totalCount,
        filteredCount: totalFilteredCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedDeletedInvoiceList };
