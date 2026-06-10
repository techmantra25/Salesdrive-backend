const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const OrderEntry = require("../../models/orderEntry.model");
const { billPrintUtil } = require("./util/billPrintUtil");
const CreditNoteModel = require("../../models/creditNote.model");
const { billStockQueue, canEnqueue } = require("../../queues/billStockQueue");
const { processBillUpdate } = require("../../workers/billingWorker");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getId = (maybeObjOrId) => {
  if (!maybeObjOrId) return null;
  if (typeof maybeObjOrId === "string") return maybeObjOrId;
  if (typeof maybeObjOrId === "object") {
    if (maybeObjOrId._id) return String(maybeObjOrId._id);
    if (maybeObjOrId.id) return String(maybeObjOrId.id);
  }
  return null;
};

const sameId = (a, b) => {
  const ida = getId(a);
  const idb = getId(b);
  if (!ida || !idb) return false;
  return ida === idb;
};

// ─── Controller ───────────────────────────────────────────────────────────────

const billUpdate = asyncHandler(async (req, res) => {
  try {
    const bid = req.params.bid;
    const { previousBillData, newBillData } = req.body;

    // ─── 1. Input validation ──────────────────────────────────────────────────
    if (!previousBillData || !newBillData) {
      return res.status(400).json({
        message:
          "Invalid request body: previousBillData and newBillData are required",
      });
    }

    // ─── 2. Bill existence check ──────────────────────────────────────────────
    const existingBill = await Bill.findById(bid);
    if (!existingBill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    // ─── 3. Validate new line items ───────────────────────────────────────────
    // Run validation here (in the controller, before enqueuing) so we can
    // return a synchronous 400 to the caller instead of discovering the
    // problem later inside the worker.
    const oldLineItems = previousBillData?.lineItems || [];
    const newLineItems = newBillData?.lineItems || [];

    for (const item of newLineItems) {
      const inventoryId = getId(item.inventoryId);
      const productId = getId(item.product);
      const priceId = getId(item.price);

      const productDoc = productId ? await Product.findById(productId) : null;
      const productCodeForMsg =
        productDoc?.product_code || productId || "unknown product";

      // 3a. Removed items are flagged by the frontend — skip all checks for them
      if (item?.itemBillType === "Item Removed") continue;

      // 3b. Inventory presence
      if (!inventoryId) {
        return res.status(400).json({
          message: `Inventory not provided for ${productCodeForMsg}.`,
        });
      }

      // 3c. Inventory existence
      const inventory = await Inventory.findById(inventoryId);
      if (!inventory) {
        return res.status(400).json({
          message: `Inventory not found for ID ${inventoryId}`,
        });
      }

      // 3d. Quantity sanity
      if (typeof item.billQty === "number" && item.billQty < 0) {
        res.status(400);
        throw new Error(`Invalid quantity for ${productCodeForMsg}`);
      }

      // 3e. Additional stock check — compare against old qty so previously
      // reserved stock is not counted against availableQty (same logic as the worker).
      const oldItem = oldLineItems.find((old) =>
        sameId(old.product, productId),
      );
      const oldQty = oldItem ? Number(oldItem.billQty || 0) : 0;
      const newQty = Number(item.billQty || 0);
      const additionalQty = newQty - oldQty;

      if (additionalQty > 0 && additionalQty > inventory.availableQty) {
        res.status(400);
        throw new Error(
          `Insufficient stock for ${productCodeForMsg}. Available: ${inventory.availableQty}, Additional needed: ${additionalQty}`,
        );
      }

      // 3f. Price validation — replacement items do not carry a price document
      if (item?.itemBillType !== "Replacement") {
        if (!priceId) {
          return res.status(404).json({
            message: `Price id missing for product ${productCodeForMsg}`,
          });
        }
        const priceDoc = await Price.findById(priceId);
        if (!priceDoc) {
          return res.status(404).json({
            message: `Price not found for ID ${priceId}`,
          });
        }
      }
    }

    // ─── 4. Build update payload ──────────────────────────────────────────────
    // This exact object is serialised into Redis (queue path) and also
    // passed directly to processBillUpdate (fallback path).
    // It contains everything the worker needs — no req.body inside the worker.
    const updatePayload = {
      bid: String(bid),
      previousBillData,
      newBillData,
    };

    // ─── 5. Try queue path first ──────────────────────────────────────────────
    let redisAvailable = false;
    try {
      redisAvailable = await canEnqueue();
    } catch (err) {
      console.warn(
        "⚠️ Redis unavailable, falling back to direct processing:",
        err.message,
      );
    }

    if (redisAvailable) {
      // ── Queue path ─────────────────────────────────────────────────────────
      const job = await billStockQueue.add("update-bill", updatePayload);

      console.log(`✅ Bill update queued — jobId: ${job.id}, billId: ${bid}`);

      return res.status(202).json({
        success: true,
        message: "Bill update queued for processing",
        jobId: job.id,
        billId: bid,
      });
    }

    // ── Direct fallback path ───────────────────────────────────────────────────
    // Redis is down — run the same processBillUpdate the worker would call
    // so there is exactly one code path for the actual DB operations.
    console.log("📋 Redis unavailable — processing bill update directly");

    const updatedBill = await processBillUpdate(updatePayload);

    // Build inventory verification summary for the response
    const inventoryChanges = await buildInventoryVerification(
      oldLineItems,
      newLineItems,
    );

    billPrintUtil([updatedBill._id]);

    return res.status(200).json({
      status: 200,
      message: "Bill updated successfully",
      data: updatedBill,
      inventoryChanges,
    });
  } catch (error) {
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 400);
    throw error;
  }
});

// ─── Inventory verification helper ───────────────────────────────────────────
// Builds the debug summary returned on the direct path.
// Not called on the queue path — the worker does not return per-item details.

const buildInventoryVerification = async (oldLineItems, newLineItems) => {
  const results = [];

  for (const item of newLineItems) {
    const inventoryId = getId(item.inventoryId);
    if (!inventoryId) continue;

    const inventory = await Inventory.findById(inventoryId);
    if (!inventory) continue;

    const productId = getId(item.product);
    const productDoc = productId ? await Product.findById(productId) : null;

    const oldItem = oldLineItems.find((old) => sameId(old.product, productId));
    const oldQty = oldItem ? Number(oldItem.billQty || 0) : 0;
    const newQty = Number(item.billQty || 0);

    results.push({
      productCode: productDoc?.product_code || productId,
      productName: productDoc?.name || "Unknown",
      oldBillQty: oldQty,
      newBillQty: newQty,
      qtyChange: newQty - oldQty,
      currentReservedQty: inventory.reservedQty,
      currentAvailableQty: inventory.availableQty,
      totalStock: inventory.reservedQty + inventory.availableQty,
    });
  }

  console.log("=== INVENTORY VERIFICATION ===");
  console.log("Inventory Changes:", JSON.stringify(results, null, 2));
  console.log("=== END VERIFICATION ===");

  return results;
};

module.exports = { billUpdate };
