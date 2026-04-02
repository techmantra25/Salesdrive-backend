const asyncHandler = require("express-async-handler");
const Supplier = require("../../models/supplier.model");

const detailSupplier = asyncHandler(async (req, res) => {
  try {
    const supplierId = req.params.sid;

    const supplierData = await Supplier.findById(supplierId).populate([
      {
        path: "stateId",
        select: "",
      },
    ]);

    if (!supplierData) {
      res.status(404);
      throw new Error("Supplier not found");
    }

    // Return successful response
    return res.status(200).json({
      status: 200,
      message: "Supplier details fetched successfully",
      data: supplierData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Export the detailSupplier function

module.exports = { detailSupplier };
