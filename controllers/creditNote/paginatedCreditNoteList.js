const asyncHandler = require("express-async-handler");
const CreditNoteModel = require("../../models/creditNote.model");

const paginatedCreditNoteList = asyncHandler(async (req, res) => {
  try {
    let {
      page,
      limit,
      fromDate,
      toDate,
      outletId,
      creditNoteType,
      creditNoteStatus,
      distributorId,
      isActive,
    } = req.query;

    // Convert query params to numbers and set default values
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        status: 400,
        message: "Page and limit should be positive integers",
      });
    }

    const skip = (page - 1) * limit;

    const query = {};

    // Add date filter for createdAt field
    if (fromDate || toDate) {
      query.creditNoteCreationDate = {};

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0); // Set to the start of the day
        query.creditNoteCreationDate.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999); // Set to the end of the day
        query.creditNoteCreationDate.$lte = endOfDay;
      }
    }

    // Filter by outletId
    if (outletId) {
      query.outletId = outletId;
    }

    // Filter by creditNoteType
    if (creditNoteType) {
      query.creditNoteType = creditNoteType;
    }

    // Filter by creditNoteStatus
    if (creditNoteStatus) {
      query.creditNoteStatus = creditNoteStatus;
    }

    // Filter by distributorId
    if (distributorId) {
      query.distributorId = distributorId;
    }

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Fetch credit notes with pagination
    const creditNoteList = await CreditNoteModel.find(query)
      .populate([
        {
          path: "lineItems.product",
          select: "",
        },
        {
          path: "lineItems.inventoryId",
          select: "",
        },
        {
          path: "lineItems.price",
          select: "",
        },
        {
          path: "lineItems.adjustmentId",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "outletId",
          select: "",
        },
        { path: "billId", select: "" },
        { path: "salesReturnId", select: "" },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    // total filter count
    const totalFilteredCount = await CreditNoteModel.countDocuments(query);

    // Count total documents for pagination metadata
    const totalCount = await CreditNoteModel.countDocuments();

    return res.status(200).json({
      status: 200,
      message: "Paginated credit note list",
      data: creditNoteList,
      pagination: {
        totalPages: Math.ceil(totalFilteredCount / limit),
        filteredItems: totalFilteredCount,
        totalItems: totalCount,
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    res.status(500);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedCreditNoteList };
