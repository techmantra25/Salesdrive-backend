const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Distributor = require("../../models/distributor.model");
const { generateCode } = require("../../utils/codeGenerator");

const createInventory = asyncHandler(async (req, res) => {
  try {
    const {
      productId,
      distributorId,
      intransitQty,
      undeliveredQty,
      availableQty,
      totalStockamtDlp,
      totalStockamtRlp,
      normsQty,
    } = req.body;

    // Fetch distributor details to get their godown types
    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(404).json({
        error: true,
        status: 404,
        message: "Distributor not found",
      });
    }

    const { goDown: godownArray } = distributor;

    if (!Array.isArray(godownArray) || godownArray.length === 0) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: "No valid godown types found for the distributor",
      });
    }

    const inventories = [];

    // Loop through distributor's godown array and create inventories accordingly
    for (let i = 0; i < godownArray.length; i++) {
      const godownType = godownArray[i];

      // Generate a unique inventory item ID for each godown type
      const inventoryItemId = await generateCode("INVT");

      const inventoryData = {
        productId,
        distributorId,
        invitemId: inventoryItemId, // Generate a unique code for each inventory entry
        godownType,
      };

      if (godownType === "main") {
        // Add additional fields for main inventory
        inventoryData.intransitQty = intransitQty;
        inventoryData.undeliveredQty = undeliveredQty;
        inventoryData.availableQty = availableQty;
        inventoryData.totalStockamtDlp = totalStockamtDlp;
        inventoryData.totalStockamtRlp = totalStockamtRlp;
        inventoryData.normsQty = normsQty;
      } else if (godownType === "damaged") {
        // Initialize damagedQty for the damaged inventory
        inventoryData.damagedQty = 0;
      }

      const newInventory = new Inventory(inventoryData);
      inventories.push(newInventory.save());
    }

    // Save all inventories to the database
    const savedInventories = await Promise.all(inventories);

    return res.status(200).json({
      status: 200,
      message: "Inventories created successfully",
      data: savedInventories,
    });
  } catch (error) {
    res.status(400).json({
      error: true,
      status: 400,
      message: error?.message || "Something went wrong",
    });
  }
});

module.exports = {
  createInventory,
};
