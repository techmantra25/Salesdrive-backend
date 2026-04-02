const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");

const paginatedOutletApproved = asyncHandler(async (req, res) => {
  try {
    const query = {};


    if (req.query.search) {
      query.$or = [
        { outletCode: { $regex: req.query.search, $options: "i" } },
        { outletUID: { $regex: req.query.search, $options: "i" } },
        { outletName: { $regex: req.query.search, $options: "i" } },
        { ownerName: { $regex: req.query.search, $options: "i" } },
        { mobile1: { $regex: req.query.search, $options: "i" } },  
        { massistRefIds: { $regex: req.query.search, $options: "i" } },
      ];
    }
    if (req.query.phoneSearch) {
      // Remove all non-numeric characters from search term
      const cleanedPhone = req.query.phoneSearch.replace(/\D/g, '');
      
      // Search for phone numbers with or without +91
      query.$or = [
        { mobile1: { $regex: cleanedPhone, $options: "i" } },
        { mobile1: { $regex: `\\+91${cleanedPhone}`, $options: "i" } },
        { mobile1: { $regex: `91${cleanedPhone}`, $options: "i" } },
      ];
    }

    if (req.query.statusFilter && req.query.statusFilter !== "All") {
  query.status = req.query.statusFilter === "active";
}

if (req.query.outletSource) {
  query.outletSource = req.query.outletSource;
}

    if (req.query.regionId) {
      query.regionId = req.query.regionId;
    }

    if (req.query.stateId) {
      query.stateId = req.query.stateId;
    }

    if (req.query.distributorId) {
      const beats = await Beat.find({
        distributorId: { $in: [req.query.distributorId] },
      });
      const beatIds = beats.map((beat) => beat._id);

      query.beatId = { $in: beatIds };
    }

    if (req.query.beatId) {
      query.beatId = req.query.beatId;
    }

    if (req.query.massistRefIds) {
      const massistRefIds = Array.isArray(req.query.massistRefIds) ? req.query.massistRefIds : [req.query.massistRefIds];
      query.massistRefIds = { $in: massistRefIds };
    }

  // CREATED DATE FILTER
if (req.query.fromDate && req.query.toDate) {
  query.createdAt = {};

  const start = new Date(req.query.fromDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(req.query.toDate);
  end.setHours(23, 59, 59, 999);

  query.createdAt.$gte = start;
  query.createdAt.$lte = end;
}

// UPDATED DATE FILTER
if (req.query.updatedFromDate && req.query.updatedToDate) {
  query.updatedAt = {};

  const start = new Date(req.query.updatedFromDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(req.query.updatedToDate);
  end.setHours(23, 59, 59, 999);

  query.updatedAt.$gte = start;
  query.updatedAt.$lte = end;
}


    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const outletsApproved = await OutletApproved.find(query)
      .populate([
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "rsm",
          select: "",
        },
        {
          path: "asm",
          select: "",
        },
        {
          path: "zsm",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },

        {
          path: "distributorId",
          select: "",
        },

        {
          path: "sellingBrands",
          select: "",
        },
        {
          path: "createdFromLead",
          select: "",
        },
        {
          path: "employeeId",
          select: "",
        },
        {
          path: "createdBy",
          select: "",
        },
        {
          path: "district",
          select: "",
        },
        {
          path: "referenceId",
          select: "",
        },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const filteredCount = await OutletApproved.countDocuments(query);
    const totalItems = await OutletApproved.countDocuments();

    return res.status(200).json({
      status: 200,
      message: "Outlet Approved list",
      data: outletsApproved,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        totalCount: totalItems,
        filteredCount: filteredCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  paginatedOutletApproved,
};
