const asyncHandler = require("express-async-handler");
const Godown = require("../../models/godown.model");

const viewGodown = asyncHandler(async (req, res) => {
  try {
    // Pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const skip = (page - 1) * limit;

    // Filters
    const { godownName, distributorId: queryDistributorId } = req.query;

    const filter = {};

    if (req.userType === "distributor") {
      // Distributors can only ever see their own godowns.
      filter.distributorId = req.user._id;
    } else {
      // Admin / employee: distributorId is optional.
      // If provided, scope the list to that distributor.
      // If omitted, return godowns across all distributors.
      if (queryDistributorId) {
        filter.distributorId = queryDistributorId;
      }
    }

    // Godown name search
    if (godownName && godownName.trim()) {
      filter.godownName = {
        $regex: godownName.trim(),
        $options: "i",
      };
    }

    // Get total count
    const totalGodowns = await Godown.countDocuments(filter);

    // Get paginated data
    const godowns = await Godown.find(filter)
      .populate("distributorId", "name dbCode email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalGodowns / limit);

    return res.status(200).json({
      success: true,
      message: "Godown list fetched successfully",

      data: godowns,

      pagination: {
        currentPage: page,
        limit,
        totalRecords: totalGodowns,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("View Godown Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch godown list",
      error: error.message,
    });
  }
});

module.exports = {
  viewGodown,
};