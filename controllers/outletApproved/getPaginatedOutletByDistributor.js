const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");

const getPaginatedOutletByDistributor = asyncHandler(async (req, res) => {
  try {
    const { did } = req.params;

    const {
      page = 1,
      limit = 20,
      outletName,
      outletCode,
      outletUID,
      mobile,
      outletSource,
      stateId,
      fromDate,
      toDate,
      status,
    } = req.query;

    // FIND BEATS
    const beats = await Beat.find({ distributorId: did }).select("_id");
    const beatIds = beats.map((b) => b._id);

    // BASE QUERY
    const baseQuery = {
      beatId: { $in: beatIds },
    };

    const filterQuery = { ...baseQuery };

    // FILTERS
    if (status === "Active") filterQuery.status = true;
    if (status === "Inactive") filterQuery.status = false;

    if (outletName)
      filterQuery.outletName = { $regex: outletName, $options: "i" };

    if (outletCode)
      filterQuery.outletCode = { $regex: `^${outletCode}`, $options: "i" };

    if (outletUID)
      filterQuery.outletUID = { $regex: `^${outletUID}`, $options: "i" };

    if (mobile)
      filterQuery.mobile1 = { $regex: `^${mobile}` };

    if (outletSource) filterQuery.outletSource = outletSource;
    if (stateId) filterQuery.stateId = stateId;

    if (fromDate || toDate) {
      filterQuery.createdAt = {};
      if (fromDate) filterQuery.createdAt.$gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filterQuery.createdAt.$lte = end;
      }
    }

    const skip = (page - 1) * limit;

    const [data, totalCount, filteredCount] = await Promise.all([
      OutletApproved.find(filterQuery)
        .populate([
          { path: "stateId", select: "name slug" },
          {
            path: "beatId",
            select: "name code", 
          },
          { path: "distributorId", select: "name" },
        ])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),

      OutletApproved.countDocuments(baseQuery),
      OutletApproved.countDocuments(filterQuery),
    ]);

    res.status(200).json({
      success: true,
      data,
      counts: {
        total: totalCount,
        filtered: filteredCount,
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(filteredCount / limit),
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message || "Something went wrong");
  }
});

module.exports = { getPaginatedOutletByDistributor };
