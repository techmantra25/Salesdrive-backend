const asyncHandler = require("express-async-handler");
const Plant = require("../../models/plant.model");

const paginatedListOfPlant = asyncHandler(async (req, res) => {
  try {
    let { page = 1, limit = 10, stateId, status, search } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    let filter = {};
    if (stateId) filter.stateId = stateId;
    if (status) filter.status = status;

    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { plantCode: searchRegex },
        { plantName: searchRegex },
        { plantShortName: searchRegex },
        { city: searchRegex },
        { pinCode: searchRegex },
      ];
    }

    const plants = await Plant.find(filter)
      .populate({
        path: "stateId",
        select: "", // optionally include fields like `name` if needed
      })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await Plant.countDocuments(); // total plants without any filter
    const totalFilteredCount = await Plant.countDocuments(filter); // filtered plants

    return res.status(200).json({
      status: 200,
      message: "Plants fetched successfully",
      data: plants,
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
  paginatedListOfPlant,
};
