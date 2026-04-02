const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");

const beatAllListPaginated = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      status,
      regionId,
      distributorId,
      search,
    } = req.query;
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    let filter = {};
    if (status) {
      filter.status = status === "true";
    }
    if (regionId) {
      filter.regionId = regionId;
    }
    if (distributorId) {
      filter.distributorId = { $in: [distributorId] };
    }

    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { beatIds: searchRegex },
      ];
    }

    const beats = await Beat.find(filter)
      .populate([
        {
          path: "regionId",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "employeeId",
          select: "",
          populate: [
            {
              path: "desgId",
              select: "",
            },
          ],
        },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(Number(limit));

    const totalCount = await Beat.countDocuments();
    const totalFilteredCount = await Beat.countDocuments(filter);
    const totalActiveCount = await Beat.countDocuments({ status: true });

    return res.status(200).json({
      status: 200,
      message: "All beats list paginated with filters",
      data: beats,
      pagination: {
        currentPage: page,
        limit: Number(limit),
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

module.exports = { beatAllListPaginated };
