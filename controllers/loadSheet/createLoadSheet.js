const asyncHandler = require("express-async-handler");
const LoadSheet = require("../../models/loadSheet.model");
const Bill = require("../../models/bill.model");
const { generateCode } = require("../../utils/codeGenerator");
const { default: axios } = require("axios");
const FormData = require("form-data");
const { SERVER_URL } = require("../../config/server.config");

const createLoadSheet = asyncHandler(async (req, res) => {
  try {
    const { billIds, vehicleId, deliveryBoyId, beatId, retailerId } = req.body;

    const loadSheetExist = await LoadSheet.findOne({
      billIds: { $in: billIds },
      distributorId: req.user._id,
    });
    if (loadSheetExist) {
      res.status(400);
      throw new Error("LoadSheet already exists");
    }

    const allocationNogen = await generateCode("ALC");

    const loadSheetData = await LoadSheet.create({
      allocationNo: allocationNogen,
      distributorId: req.user._id,
      billIds,
      vehicleId,
      deliveryBoyId,
      beatId,
      retailerId,
    });

    // Batch update bills to associate them with the new LoadSheet
    await Bill.updateMany(
      { _id: { $in: billIds } },
      { $set: { loadSheetId: loadSheetData._id, status: "Vehicle Allocated" } }
    );

    res.status(200).json({
      status: 200,
      message: "LoadSheet created successfully",
      data: loadSheetData,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { createLoadSheet };
