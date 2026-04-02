const asyncHandler = require("express-async-handler");
const Supplier = require("../../models/supplier.model");
// const { generateCode } = require("../../utils/codeGenerator");

const createSupplier = asyncHandler(async (req, res) => {
  try {
    const {
      supplierCode,
      coCode,
      supplierName,
      address,
      supplierType,
      distributorId,
      stateId,
      gstNo,
      contactNo,
      email,
      city,
      pinCode,
      status,
    } = req.body;

    // Check if a supplier with the same supplierCode exists
    let supplierExist = await Supplier.findOne({
      supplierCode: supplierCode,
    });

    if (supplierExist) {
      res.status(400);
      throw new Error("Supplier already exists");
    }

    // Create new supplier data
    const supplierData = await Supplier.create({
      supplierCode,
      coCode,
      supplierName,
      address,
      supplierType,
      distributorId,
      stateId,
      gstNo,
      contactNo,
      email,
      city,
      pinCode,
      status,
    });

    // Return successful response
    return res.status(201).json({
      status: 201,
      message: "Supplier created successfully",
      data: supplierData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createSupplier };
