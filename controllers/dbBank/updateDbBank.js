const asyncHandler = require("express-async-handler");
const DbBank = require("../../models/dbBank.model");

// @desc    Update distributor bank details
// @route   PUT /api/db-bank/update
// @access  Private (Distributor only)
const updateDbBank = asyncHandler(async (req, res) => {
  const distributorId = req.user?._id;

  if (!distributorId) {
    return res.status(401).json({ status: 401, message: "Unauthorized access" });
  }

  const bankData = await DbBank.findOne({ distributorId });

  if (!bankData) {
    return res.status(404).json({ status: 404, message: "Bank details not found" });
  }

  // Update only the provided fields
  const fieldsToUpdate = ["bankName", "branchCode", "accountType", "accountNumber", "ifscCode"];

  fieldsToUpdate.forEach((field) => {
    if (req.body[field] !== undefined) {
      bankData[field] = req.body[field];
    }
  });

  const updatedBank = await bankData.save();

  return res.status(200).json({
    status: 200,
    message: "Bank details updated successfully",
    data: updatedBank,
  });
});

module.exports = { updateDbBank };
