const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

// const searchOutletsForDropdown = asyncHandler(async (req, res) => {
//   try {
//     console.log("Backend received query:", req.query);
//     const query = {};
//     query.status = true;

//     if (req.query.includeInactive === "true") {
//       delete query.status;
//     }

//     // if (req.query.includeInactive === "true") {
//     //   query.status = false;
//     // } else {
//     //   query.status = true;
//     // }

//     // Search functionality - only search relevant fields
//     if (req.query.search) {
//       const searchTerm = req.query.search.trim();
//       const searchRegex = { $regex: searchTerm, $options: "i" };
//       query.$or = [
//         { outletName: searchRegex },
//         { outletUID: searchRegex },
//         { mobile1: searchRegex },
//       ];
//     }
//     console.log("MongoDB query:", JSON.stringify(query, null, 2));

//     // Pagination
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 50;
//     const skip = (page - 1) * limit;

//     // Only select required fields for dropdown
//     const outlets = await OutletApproved.find(query)
//       .select("outletName outletUID mobile1 status _id")
//       .sort({ outletName: 1 })
//       .skip(skip)
//       .limit(limit)
//       .lean();
//     console.log("Found outlets:", outlets.length);

//     const totalCount = await OutletApproved.countDocuments(query);
//     const totalPages = Math.ceil(totalCount / limit);

//     return res.status(200).json({
//       status: 200,
//       message: "Outlet search results",
//       data: outlets,
//       pagination: {
//         currentPage: page,
//         limit,
//         totalPages,
//         totalCount,
//         hasMore: page < totalPages,
//       },
//     });
//   } catch (error) {
//     res.status(400);
//     throw new Error(error?.message || "Failed to search outlets");
//   }
// });


const searchOutletsForDropdown = asyncHandler(async (req, res) => {
  try {
    console.log("Backend received query:", req.query);
    const query = {};
    query.status = true;

    if (req.query.includeInactive === "true") {
      delete query.status;
    }

    // Search functionality
    if (req.query.search) {
      const searchTerm = req.query.search.trim();
      const searchRegex = { $regex: searchTerm, $options: "i" };

      if (req.query.exactMatch === "true") {
        // Exact match for search bar
        query.$or = [
          { outletName: searchRegex },
          { outletUID: searchTerm },
          { mobile1: searchTerm },
        ];
      } else {
        // Fuzzy match for dropdown
        query.$or = [
          { outletName: searchRegex },
          { outletUID: searchRegex },
          { mobile1: searchRegex },
        ];
      }
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const searchTerm = req.query.search ? req.query.search.trim() : null;

    const outlets = await OutletApproved.aggregate([
      { $match: query },
      {
        $addFields: {
          score: {
            $cond: [{ $eq: ["$outletUID", searchTerm] }, 0, 1],
          },
        },
      },
      { $sort: { score: 1, outletName: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { outletName: 1, outletUID: 1, mobile1: 1, status: 1 } },
    ]);

    const totalCount = await OutletApproved.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      status: 200,
      message: "Outlet search results",
      data: outlets,
      pagination: {
        currentPage: page,
        limit,
        totalPages,
        totalCount,
        hasMore: page < totalPages,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Failed to search outlets");
  }
});

module.exports = {
  searchOutletsForDropdown,
};