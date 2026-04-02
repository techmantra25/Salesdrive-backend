const asyncHandler = require("express-async-handler");
const Supplier = require("../../models/supplier.model");

const updateSupplier = asyncHandler(async (req, res) => {
  try {
    const supplierId = req.params.sid;
    const {
      supplierName,
      coCode,
      address,
      city,
      supplierType,
      distributorId,
      stateId,
      gstNo,
      contactNo,
      email,
      pinCode,
      status,
    } = req.body;

    const supplierData = await Supplier.findByIdAndUpdate(
      supplierId,
      {
        supplierName,
        coCode,
        city,
        address,
        supplierType,
        distributorId,
        stateId,
        gstNo,
        contactNo,
        email,
        pinCode,
        status,
      },
      {
        new: true,
      }
    );

    if (!supplierData) {
      res.status(404);
      throw new Error("Supplier not found");
    }

    // Return successful response
    return res.status(200).json({
      status: 200,
      message: "Supplier updated successfully",
      data: supplierData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Export the updateSupplier function

module.exports = { updateSupplier };
