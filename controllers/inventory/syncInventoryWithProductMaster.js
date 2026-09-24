const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Godown = require("../../models/godown.model");
const { generateCodesInBatch } = require("../../utils/codeGenerator");
const { releaseLock, acquireLock } = require("../../models/lock.model");
const notificationQueue = require("../../queues/notificationQueue");

const BATCH_SIZE = 1000;

/**
 * Behavior (per product, per active godown):
 *  - Row already exists for (product, godown)   -> left untouched.
 *  - Row missing for (product, godown)          -> created at zero stock.
 * So a product with 3 active godowns always ends up with exactly 3 rows,
 * one per godown, no matter which of them already had stock before sync
 * ran. A single godown can never end up with 2 rows for the same product.
 *
 * That guarantee is enforced at two levels:
 *  1. App level: the upsert filter is the exact triple
 *     (productId, distributorId, godownId).
 *  2. DB level (the part that actually makes it race-proof): the
 *     Inventory collection MUST have a unique compound index on
 *     { productId: 1, distributorId: 1, godownId: 1 }. Without that
 *     index, two upserts racing on the same missing triple can both
 *     "not find" a match and both insert — the unique index is what
 *     forces the second one to fail instead of silently duplicating.
 *     Add it once via:
 *       db.inventories.createIndex(
 *         { productId: 1, distributorId: 1, godownId: 1 },
 *         { unique: true }
 *       )
 *     (or the equivalent `index({...}, {unique:true})` in the Mongoose
 *     schema). This file assumes that index exists and treats a
 *     duplicate-key error on a specific pair as "already synced by a
 *     concurrent process", not a real failure.
 */
const syncInventoryWithProductMaster = asyncHandler(async (req, res) => {
  const distributorId = req.user?._id;

  // Per-distributor lock: prevents this distributor from running two
  // syncs concurrently, without blocking other distributors' syncs.
  const lockKey = `syncInventory:${distributorId}`;

  if (!(await acquireLock(lockKey))) {
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }

  try {
    const [distributor, godowns] = await Promise.all([
      Distributor.findById(distributorId),
      Godown.find({ distributorId, isActive: true }),
    ]);

    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }
    if (!distributor.openingStock) {
      return res.status(400).json({
        message: "Distributor does not have an opening stock uploaded",
      });
    }

    if (!godowns.length) {
      return res
        .status(400)
        .json({ message: "No active godowns found for the distributor" });
    }

    const brandIds = distributor.brandId || [];
    if (!brandIds.length) {
      return res
        .status(400)
        .json({ message: "No brands associated with the distributor" });
    }

    // All products this distributor should be able to stock, based on brand.
    const eligibleProducts = await Product.find({
      brand: { $in: brandIds },
      status: true,
    }).lean();

    if (!eligibleProducts.length) {
      return res.status(200).json({
        message: "No eligible products found for this distributor's brands",
        data: 0,
      });
    }

    // Existing (productId, godownId) pairs for this distributor — the
    // correct dedup key. Checked per godown, not just per product, so a
    // product with a row in Godown A but not Godown B is correctly
    // treated as "missing in B" rather than "already synced".
    const existingInventoryItems = await Inventory.find(
      { distributorId, godownId: { $in: godowns.map((g) => g._id) } },
      { productId: 1, godownId: 1, _id: 0 },
    ).lean();

    const existingPairKeys = new Set(
      existingInventoryItems.map((inv) => `${inv.productId}:${inv.godownId}`),
    );

    // Every (product, godown) combination that doesn't already have a row.
    const missingPairs = [];
    for (const product of eligibleProducts) {
      for (const godown of godowns) {
        const key = `${product._id}:${godown._id}`;
        if (!existingPairKeys.has(key)) {
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

    const inventoryItemIds = await generateCodesInBatch(
      "INVT",
      missingPairs.length,
    );

    const bulkOps = missingPairs.map(({ product, godown }, index) => ({
      updateOne: {
        filter: {
          productId: product._id,
          distributorId,
          godownId: godown._id,
        },
        update: {
          $setOnInsert: {
            invitemId: inventoryItemIds[index],
            godownType: godown.location || "main",
            createType: "syncInventory", // tags this row as sync-created
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
        upsert: true,
      },
    }));

    let inserted = 0;
    let skippedAsAlreadyExists = 0;
    const batchFailures = [];

    for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
      const batch = bulkOps.slice(i, i + BATCH_SIZE);
      const batchNum = i / BATCH_SIZE + 1;

      try {
        const result = await Inventory.bulkWrite(batch, { ordered: false });
        inserted += result.upsertedCount || 0;
        console.log(
          `Synced batch ${batchNum}: ${result.upsertedCount || 0} new inventory rows for distributor ${distributorId}`,
        );
      } catch (batchError) {
        // With ordered:false, some ops in this batch may have still
        // succeeded even though the overall call threw. Recover those
        // counts instead of losing them, and treat duplicate-key errors
        // (code 11000) as benign — it means the unique index caught a
        // race and the row already exists, which is exactly what we want,
        // not a real failure.
        const writeResult = batchError?.result || batchError?.writeResult;
        const partialUpserted =
          writeResult?.nUpserted ?? writeResult?.upsertedCount ?? 0;
        inserted += partialUpserted;

        const writeErrors = batchError?.writeErrors || [];
        const dupKeyErrors = writeErrors.filter((e) => e.code === 11000);
        const otherErrors = writeErrors.filter((e) => e.code !== 11000);

        skippedAsAlreadyExists += dupKeyErrors.length;

        if (otherErrors.length) {
          console.error(
            `Batch ${batchNum}: ${otherErrors.length} non-duplicate write errors`,
            otherErrors.slice(0, 5),
          );
          batchFailures.push({ batchNum, errorCount: otherErrors.length });
        }

        if (dupKeyErrors.length) {
          console.log(
            `Batch ${batchNum}: ${dupKeyErrors.length} pairs already existed (race with a concurrent writer) — skipped safely.`,
          );
        }

        if (!writeErrors.length) {
          // Unexpected error shape (not a BulkWriteError) — log for
          // visibility, don't silently swallow it.
          console.error(`Batch ${batchNum} failed unexpectedly:`, batchError);
          batchFailures.push({ batchNum, errorCount: batch.length });
        }
      }
    }

    const notificationMessage = `Successfully synced ${inserted.toLocaleString("en-In")} new product-godown entr${inserted === 1 ? "y" : "ies"} to your inventory`;
    await notificationQueue.add("inventorySync", {
      type: "inventory",
      data: {
        message: notificationMessage,
        title: "Inventory Sync Completed",
        entriesAdded: inserted,
      },
      userId: distributorId,
      userType: "Distributor",
    });

    res.status(201).json({
      message: "Inventory synced with product master successfully",
      data: inserted,
      skippedAsAlreadyExists,
      batchFailures: batchFailures.length ? batchFailures : undefined,
    });
  } catch (error) {
    res.status(500);
    throw error;
  } finally {
    await releaseLock(lockKey);
  }
});

module.exports = { syncInventoryWithProductMaster };