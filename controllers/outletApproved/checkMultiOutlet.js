const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

// Count outlets based on mobile1
const countOutletsByMobile1 = asyncHandler(async (req, res) => {
  try {
    const result = await OutletApproved.aggregate([
      {
        $match: {
          mobile1: { $ne: null, $ne: "" },
          status: true,
        },
      },
      {
        // Convert number → string to avoid scientific notation
        $addFields: {
          mobile1String: { $toString: "$mobile1" },
        },
      },
      {
        $group: {
          _id: "$mobile1String",
          count: { $sum: 1 },
          outletUIDs: { $push: "$outletUID" },
          outletNames: { $push: "$outletName" },
          currentPointBalances: { $push: "$currentPointBalance" },
          outletSources: { $push: "$outletSource" },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          mobile1: "$_id",
          count: 1,
          outletUIDs: 1,
          outletNames: 1,
          currentPointBalances: 1,
          outletSources: 1,
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = { countOutletsByMobile1 };
