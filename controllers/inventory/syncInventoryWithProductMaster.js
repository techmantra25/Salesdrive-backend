const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
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

    // Fetch distributor and inventory in parallel
    const [distributor, inventoryItems] = await Promise.all([
      Distributor.findById(distributorId),
      Inventory.find({ distributorId }, { productId: 1, _id: 0 }),
    ]);

    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }
    if (!distributor.openingStock) {
      return res.status(400).json({
        message: "Distributor does not have an opening stock uploaded",
      });
    }
    // if (!inventoryItems || !inventoryItems.length) {
    //   return res
    //     .status(404)
    //     .json({ message: "No inventory items found for the distributor" });
    // }

    const brandIds = distributor.brandId || [];
    if (!brandIds.length) {
      return res
        .status(400)
        .json({ message: "No brands associated with the distributor" });
    }

    const productIds = inventoryItems.map((inv) => inv.productId);

    // Find products to add
    const productsToAdd = await Product.find({
      _id: { $nin: productIds },
      brand: { $in: brandIds },
      status: true,
    });

    if (!productsToAdd.length) {
      return res.status(200).json({
        message: "Inventory is already in sync with product master",
        data: 0,
      });
    }

    // Generate all inventory IDs in batch
    const inventoryItemIds = await generateCodesInBatch(
      "INVT",
      productsToAdd.length
    );

    // Prepare bulkWrite operations
    const bulkOps = productsToAdd.map((product, index) => ({
      insertOne: {
        document: {
          productId: product._id,
          distributorId,
          invitemId: inventoryItemIds[index],
          godownType: "main",
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
    const notificationMessage = `Successfully synced ${(productsToAdd.length)?.toLocaleString("en-In")} new product(s) to your inventory`;
    await notificationQueue.add("inventorySync", {
      type: "inventory",
      data: {
        message: notificationMessage,
        title: "Inventory Sync Completed",
        entriesAdded: productsToAdd.length,
      },
      userId: distributorId,
      userType: "Distributor",
    });

    res.status(201).json({
      message: "Inventory synced with product master successfully",
      data: productsToAdd.length,
    });
  } catch (error) {
    res.status(500);
    throw error;
  } finally {
    await releaseLock("syncInventory");
  }
});

module.exports = { syncInventoryWithProductMaster };
