const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Godown = require("../../models/godown.model");
const { generateCodesInBatch } = require("../../utils/codeGenerator");
const { releaseLock, acquireLock } = require("../../models/lock.model");
const notificationQueue = require("../../queues/notificationQueue");

const BATCH_SIZE = 1000;

const syncInventoryWithProductMaster = asyncHandler(async (req, res) => {
  if (!(await acquireLock("syncInventory"))) {
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }

  try {
    const distributorId = req.user?._id;

    // Fetch distributor, godowns and existing inventory in parallel
    const [distributor, godowns, inventoryItems] = await Promise.all([
      Distributor.findById(distributorId),
      Godown.find({ distributorId, isActive: true }),
      Inventory.find(
        { distributorId },
        { productId: 1, godownId: 1, _id: 0 }
      ),
    ]);

    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }
    if (!distributor.openingStock) {
      return res.status(400).json({
        message: "Distributor does not have an opening stock uploaded",
      });
    }

    const brandIds = distributor.brandId || [];
    if (!brandIds.length) {
      return res
        .status(400)
        .json({ message: "No brands associated with the distributor" });
    }

    if (!godowns.length) {
      return res
        .status(400)
        .json({ message: "No godowns found for the distributor" });
    }

    // All products the distributor is entitled to stock, per brand mapping
    const productsMaster = await Product.find({
      brand: { $in: brandIds },
      status: true,
    });

    if (!productsMaster.length) {
      return res.status(200).json({
        message: "Inventory is already in sync with product master",
        data: 0,
      });
    }

    // ---- Per-(product, godown) existence check ----
    // A product can be missing from one godown while already present in
    // another (e.g. godown A already has it, newly added godown B does
    // not), so we key existing inventory by productId+godownId rather
    // than productId alone.
    const existingPairs = new Set(
      inventoryItems.map(
        (inv) => `${inv.productId}-${inv.godownId}`
      )
    );

    // Build the list of missing (product, godown) combinations
    const missingPairs = [];
    for (const godown of godowns) {
      for (const product of productsMaster) {
        const key = `${product._id}-${godown._id}`;
        if (!existingPairs.has(key)) {
          missingPairs.push({ product, godown });
        }
      }
    }

    if (!missingPairs.length) {
      return res.status(200).json({
        message: "Inventory is already in sync with product master",
        data: 0,
      });
    }

    // Generate all inventory IDs in batch
    const inventoryItemIds = await generateCodesInBatch(
      "INVT",
      missingPairs.length
    );

    // Prepare bulkWrite operations
    const bulkOps = missingPairs.map(({ product, godown }, index) => ({
      insertOne: {
        document: {
          productId: product._id,
          distributorId,
          invitemId: inventoryItemIds[index],
          godownId: godown._id,
          godownType: godown.godownType,
          availableQty: 0,
          unsalableQty: 0,
          offerQty: 0,
          totalQty: 0,
          totalStockamtDlp: 0,
          totalStockamtRlp: 0,
          totalUnsalableamtDlp: 0,
          totalUnsalableStockamtRlp: 0,
          intransitQty: 0,
          undeliveredQty: 0,
          normsQty: 0,
        },
      },
    }));

    // Batched bulkWrite
    let inserted = 0;
    for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
      const batch = bulkOps.slice(i, i + BATCH_SIZE);
      try {
        await Inventory.bulkWrite(batch, { ordered: false });
        inserted += batch.length;
        console.log(
          `Inserted ${inserted}/${bulkOps.length} inventory items for distributor ${distributorId}`
        );
      } catch (batchError) {
        console.error(
          `Error inserting batch ${i / BATCH_SIZE + 1}:`,
          batchError
        );
      }
    }

    // 🔔 Send notification to distributor about inventory sync
    const notificationMessage = `Successfully synced ${(missingPairs.length)?.toLocaleString("en-In")} new inventory item(s) across ${godowns.length} godown(s)`;
    await notificationQueue.add("inventorySync", {
      type: "inventory",
      data: {
        message: notificationMessage,
        title: "Inventory Sync Completed",
        entriesAdded: missingPairs.length,
      },
      userId: distributorId,
      userType: "Distributor",
    });

    res.status(201).json({
      message: "Inventory synced with product master successfully",
      data: missingPairs.length,
    });
  } catch (error) {
    res.status(500);
    throw error;
  } finally {
    await releaseLock("syncInventory");
  }
});

module.exports = { syncInventoryWithProductMaster };