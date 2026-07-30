const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");

// Whitelist of fields the table is allowed to sort by.
// Only fields that live directly on the OutletApproved document can be
// used here — populated (referenced) fields like stateId.name, district.name
// etc. CANNOT be sorted via .sort() because population runs after the query
// resolves. Sorting on those would require an aggregation pipeline with
// $lookup instead of .find().populate().
const SORTABLE_FIELDS = {
  outletName: "outletName",
  ownerName: "ownerName",
  outletCode: "outletCode",
  outletUID: "outletUID",
  mobile1: "mobile1",
  mobile2: "mobile2",
  email: "email",
  city: "city",
  pin: "pin",
  location: "location",
  address1: "address1",
  gstin: "gstin",
  panNumber: "panNumber",
  aadharNumber: "aadharNumber",
  status: "status",
  outletSource: "outletSource",
  retailerClass: "retailerClass",
  categoryOfOutlet: "categoryOfOutlet",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

// Whitelist of fields the free-text "search" box is allowed to match against.
// Same defaults as before (kept 1:1 with the old hardcoded $or), but now
// expressed as a list so new fields can be added here without touching
// the query-building logic below.
const SEARCHABLE_FIELDS = [
  "outletCode",
  "outletUID",
  "outletName",
  "sudoName",
  "ownerName",
  "mobile1",
  "massistRefIds",
];

const AGGREGATE_SORTABLE_FIELDS = new Set(["beat"]);

// Shared populate list used by every path that returns full outlet docs,
// so the beat-sort aggregation path and the normal path stay in sync.
const OUTLET_POPULATE = [
  { path: "zoneId", select: "" },
  { path: "rsm", select: "" },
  { path: "asm", select: "" },
  { path: "zsm", select: "" },
  { path: "regionId", select: "" },
  { path: "stateId", select: "" },
  {
    path: "beatId",
    select: "",
    populate: { path: "subDivisionId", select: "" },
  },
  { path: "distributorId", select: "" },
  { path: "sellingBrands", select: "" },
  { path: "createdFromLead", select: "" },
  { path: "employeeId", select: "" },
  { path: "createdBy", select: "" },
  { path: "district", select: "" },
  { path: "referenceId", select: "" },
];

// Builds the $or clause for the free-text search box dynamically from
// SEARCHABLE_FIELDS, instead of a hardcoded array of { field: regex } objects.
const buildSearchQuery = (searchTerm) => {
  const words = searchTerm
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return {};

  // One $or per word (word can match any field), ANDed together.
  const andClauses = words.map((word) => ({
    $or: SEARCHABLE_FIELDS.map((field) => ({
      [field]: { $regex: word, $options: "i" },
    })),
  }));

  return andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
};

const buildSortOption = (query) => {
  // Legacy param support (existing frontend toggle) — keep working as-is.
  if (query.outletname_sort === "a_to_z") {
    return { outletName: 1 };
  }
  if (query.outletname_sort === "z_to_a") {
    return { outletName: -1 };
  }

  // Generic sortBy / sortOrder support for any whitelisted column.
  const requestedField = query.sortBy;
  const field = SORTABLE_FIELDS[requestedField];

  if (field) {
    const direction =
      String(query.sortOrder).toLowerCase() === "desc" ? -1 : 1;
    // Secondary tiebreaker keeps pagination stable when many rows share
    // the same sort value.
    return { [field]: direction, _id: -1 };
  }

  return { _id: -1 };
};

const fetchBeatSortedIds = async (query, direction) => {
  const rows = await OutletApproved.aggregate([
    { $match: query },
    {
      $lookup: {
        from: Beat.collection.name,
        localField: "beatId",
        foreignField: "_id",
        as: "beatDocs",
      },
    },
    {
      $addFields: {
        beatSortName: {
          $ifNull: [{ $arrayElemAt: ["$beatDocs.name", 0] }, ""],
        },
      },
    },
    { $sort: { beatSortName: direction, _id: -1 } },
    { $project: { _id: 1 } },
  ]);

  return rows.map((r) => r._id);
};

const paginatedOutletApproved = asyncHandler(async (req, res) => {
  try {
    const query = {};

    if (req.query.search) {
      const searchQuery = buildSearchQuery(req.query.search);
      Object.assign(query, searchQuery);
    }
    if (req.query.phoneSearch) {
      // Remove all non-numeric characters from search term
      const cleanedPhone = req.query.phoneSearch.replace(/\D/g, "");

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
      const massistRefIds = Array.isArray(req.query.massistRefIds)
        ? req.query.massistRefIds
        : [req.query.massistRefIds];
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

    // BEAT SORT (aggregation path — see fetchBeatSortedIds above)
    if (AGGREGATE_SORTABLE_FIELDS.has(req.query.sortBy)) {
      const direction =
        String(req.query.sortOrder).toLowerCase() === "desc" ? -1 : 1;

      const sortedIds = await fetchBeatSortedIds(query, direction);
      const filteredCount = sortedIds.length;
      const totalItems = await OutletApproved.countDocuments();
      const pageIds = sortedIds.slice(skip, skip + limit);

      const unorderedDocs = await OutletApproved.find({
        _id: { $in: pageIds },
      }).populate(OUTLET_POPULATE);

      // $in does not preserve order, so re-apply the sorted order here.
      const orderIndex = new Map(pageIds.map((id, idx) => [String(id), idx]));
      const outletsApproved = unorderedDocs.sort(
        (a, b) => orderIndex.get(String(a._id)) - orderIndex.get(String(b._id))
      );

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
    }

    // SORTING (whitelisted — see buildSortOption / SORTABLE_FIELDS above)
    const sortOption = buildSortOption(req.query);

    const outletsApproved = await OutletApproved.find(query)
      .populate(OUTLET_POPULATE)
      .sort(sortOption)
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