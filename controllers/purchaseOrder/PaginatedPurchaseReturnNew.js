const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const Purchasereturnmodel = require("../../models/PurchasereturnNew.model");

const PaginatedPurchaseReturnNew = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      fromDate,
      toDate,
      distributorId,
      godownId,
    } = req.query;

    const currentPage = Math.max(parseInt(page, 10) || 1, 1);
    const pageLimit = Math.max(parseInt(limit, 10) || 10, 1);
    const skip = (currentPage - 1) * pageLimit;

    const filter = {};

    // Search by Return Number
    if (search && search.trim() !== "") {
      filter.code = {
        $regex: search.trim(),
        $options: "i",
      };
    }

    // Distributor Filter
    if (distributorId) {
      if (!mongoose.Types.ObjectId.isValid(distributorId)) {
        res.status(400);
        throw new Error("Invalid distributor ID");
      }

      filter.distributorId = distributorId;
    }

    // Godown Filter
    if (godownId) {
      if (!mongoose.Types.ObjectId.isValid(godownId)) {
        res.status(400);
        throw new Error("Invalid godown ID");
      }

      filter.godownId = godownId;
    }

    // Date Filter
    if (fromDate || toDate) {
      filter.returnDate = {};

      if (fromDate) {
        const startDate = new Date(fromDate);

        if (isNaN(startDate.getTime())) {
          res.status(400);
          throw new Error("Invalid fromDate");
        }

        startDate.setHours(0, 0, 0, 0);
        filter.returnDate.$gte = startDate;
      }

      if (toDate) {
        const endDate = new Date(toDate);

        if (isNaN(endDate.getTime())) {
          res.status(400);
          throw new Error("Invalid toDate");
        }

        endDate.setHours(23, 59, 59, 999);
        filter.returnDate.$lte = endDate;
      }
    }

    // Total Records
    const totalRecords = await Purchasereturnmodel.countDocuments(filter);

    // Fetch Data
    const purchaseReturns = await Purchasereturnmodel
      .find(filter)
      .populate("distributorId")
      .populate("godownId")
      .populate("lineItems.productId")
      .sort({
        returnDate: -1,
        createdAt: -1,
      })
      .skip(skip)
      .limit(pageLimit);

    const totalPages = Math.ceil(totalRecords / pageLimit);

    res.status(200).json({
      success: true,
      data: purchaseReturns,
      pagination: {
        currentPage,
        limit: pageLimit,
        totalRecords,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error("Paginated Purchase Return Error:", error);

    res.status(error.statusCode || 500);

    throw new Error(
      error.message || "Failed to fetch purchase return data"
    );
  }
});

module.exports = {
  PaginatedPurchaseReturnNew,
};