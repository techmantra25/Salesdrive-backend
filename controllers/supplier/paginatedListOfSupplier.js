const asyncHandler = require("express-async-handler");
const Supplier = require("../../models/supplier.model");

const paginatedListOfSupplier = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      supplierType,
      stateId,
      pinCode,
      status,
      distributorId,
      search,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    let filter = {};
    if (supplierType) filter.supplierType = supplierType;
    if (stateId) filter.stateId = stateId;
    if (pinCode) filter.pinCode = pinCode;
    if (status) filter.status = status;
    if (distributorId) filter.distributorId = distributorId;

    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { supplierCode: searchRegex },
        { coCode: searchRegex },
        { supplierName: searchRegex },
        { city: searchRegex },
        { pinCode: searchRegex },
      ];
    }

    const suppliers = await Supplier.find(filter)
      .populate([
        {
          path: "stateId",
          select: "",
        },
        {
          path: "distributorId",
          select: "name dbCode",
        },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Supplier.countDocuments();
    const totalFilteredCount = await Supplier.countDocuments(filter);

    return res.status(200).json({
      status: 200,
      message: "Suppliers fetched successfully",
      data: suppliers,
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

module.exports = {
  paginatedListOfSupplier,
};
