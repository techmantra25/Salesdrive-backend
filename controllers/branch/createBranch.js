const { Branch } = require("../../models/branch.model");
const mongoose = require("mongoose");

// Create a new branch
const createBranch = async (req, res) => {
  try {
    const {
      branchName,
      branchCode,
      ifscCode,
      address,
      city,
      state,
      pincode,
      bank,
      status,
    } = req.body;
    const distributorId = req.user._id;

    // Ensure all required fields are provided
    if (
      !branchName ||
      !branchCode ||
      !ifscCode ||
      !address ||
      !city ||
      !state ||
      !pincode ||
      !bank
    ) {
      return res
        .status(400)
        .json({ error: "All required fields must be provided." });
    }

    // Create a new branch
    const newBranch = new Branch({
      branchName,
      distributorId: new mongoose.Types.ObjectId(distributorId),
      branchCode,
      ifscCode,
      address,
      city,
      state,
      pincode,
      bank: new mongoose.Types.ObjectId(bank),
      status,
    });

    await newBranch.save(); // Save the branch in the database
    res.status(200).json({ status: 200, data: newBranch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createBranch,
};
