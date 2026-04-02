const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");

const inventoryDetail = asyncHandler(async (req, res) => {
  try {
    const inventoryData = await Inventory.findOne({
      _id: req.params.inventoryId,
    }).populate([
      {
        path: "productId",
        select: " ",
      },
      {
        path: "distributorId",
        select: " ",
      },
    ]);
    if (!inventoryData) {
      res.status(404);
      throw new Error("Inventory not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Inventory details retrieved successfully",
      data: inventoryData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  inventoryDetail,
};
