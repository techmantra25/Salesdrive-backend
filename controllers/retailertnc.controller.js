const asyncHandler = require("express-async-handler");
const RetailerTnC = require("../models/retailerTnCModel");

const upsertRetailerTnC = asyncHandler(async (req, res) => {
  try {
    const { tnc } = req.body;

    // Check if the retailer TnC already exists
    let retailerTnC = await RetailerTnC.findOne({});

    if (retailerTnC) {
      // Update existing TnC
      retailerTnC.tnc = tnc;
      await retailerTnC.save();
    } else {
      // Create new TnC
      retailerTnC = await RetailerTnC.create({ tnc });
    }

    return res.status(200).json({
      status: 200,
      message: "Retailer TnC updated successfully",
      data: retailerTnC,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

const getRetailerTnC = asyncHandler(async (req, res) => {
  console.log("Fetching retailer TnC...");
  try {
    const retailerTnC = await RetailerTnC.findOne({});

    if (!retailerTnC) {
      // No TnC found, return empty/default response
      return res.status(200).json({
        status: 200,
        message: "No T&C found",
        data: null,
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Retailer T&C retrieved successfully",
      data: retailerTnC,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = {
  upsertRetailerTnC,
  getRetailerTnC,
};
