const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

// Get all outlet IDs where massistRefIds is empty or not present
const getEmptyMassistRefIds = asyncHandler(async (req, res) => {
  try {
    // Find records where massistRefIds array is empty or not existing
    const outlets = await OutletApproved.find({
      $or: [
        { massistRefIds: { $exists: false } },
        { massistRefIds: { $size: 0 } }
      ]
    }).select("_id outletCode outletName");

    return res.status(200).json({
      count: outlets.length,
      outlets,
    });

  } catch (error) {
    console.error("Error fetching empty massistRefIds:", error);
    res.status(500);
    throw new Error("Internal server error");
  }
});

module.exports = { getEmptyMassistRefIds };
