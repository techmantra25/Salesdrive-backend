const asyncHandler = require("express-async-handler");
const Godown = require("../../models/godown.model");

const viewGodown = asyncHandler(async (req, res) => {
  try {
    // Only distributor can view their godowns
    if (req.userType !== "distributor") {
      return res.status(403).json({
        success: false,
        message: "Only distributor can view godowns",
      });
    }

    // Logged-in distributor MongoDB _id
    const distributorId = req.user._id;

    // Pagination
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const skip = (page - 1) * limit;

    // Filter
    const { godownName } = req.query;

    const filter = {
      distributorId,
    };

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