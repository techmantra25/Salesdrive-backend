const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model.js");

/**
 * Bulk update allowRLPEdit for distributors
 * @route POST /api/v1/distributor-rlp/bulk-update
 * @access Private (Admin)
 */
const bulkUpdateAllowRLPEdit = asyncHandler(async (req, res) => {
  const { distributorIds, allowRLPEdit } = req.body;

  // Validate boolean
  if (typeof allowRLPEdit !== "boolean") {
    res.status(400);
    throw new Error("allowRLPEdit must be a boolean value");
  }

  let query = {};

  // Update all active distributors
  if (distributorIds === "ALL") {
    query = {
      status: true,
      allowRLPEdit: { $ne: allowRLPEdit } // avoid unnecessary writes
    };
  } 
  // Update specific distributors
  else {
    if (!Array.isArray(distributorIds) || distributorIds.length === 0) {
      res.status(400);
      throw new Error("distributorIds must be a non-empty array or 'ALL'");
    }

    query = {
      _id: { $in: distributorIds }, // strings are fine
      allowRLPEdit: { $ne: allowRLPEdit }
    };
  }

  const result = await Distributor.updateMany(query, {
    $set: { allowRLPEdit }
  });

  res.status(200).json({
    status: 200,
    message: `Successfully updated ${result.modifiedCount} distributors`,
    data: {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      allowRLPEdit
    }
  });
});

module.exports = {
  bulkUpdateAllowRLPEdit
};