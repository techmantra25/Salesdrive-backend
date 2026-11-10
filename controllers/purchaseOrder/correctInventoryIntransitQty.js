const mongoose = require("mongoose");
const { generateCode } = require("../../utils/codeGenerator"); // adjust path if needed

/*
 * Rebuilds inventory.intransitQty from purchase orders.
 *
 * Rule:
 *   For every PO whose invoicestatus is Pending / Partially-Invoiced,
 *   in-transit qty for a product = orderQty - qty already received through
 *   successful GRN invoices (never below 0).
 *
 * Inventory is matched per distributor + product + godown:
 *   1. line.inventoryId (if it exists and its mapping is correct)
 *   2. otherwise lookup by distributorId + productId + godownId
 *   3. otherwise create a new inventory (same as createPurchaseOrder does)
 *      and write the new inventoryId back to the PO line.
 *
 * Query params (all optional):
 *   distributorId=<id>      only this distributor
 *   purchaseOrderNo=<no>    only this PO (useful for testing)
 *   dryRun=true             calculate and report, write nothing
 *   createMissing=false     do not create missing inventories
 *   resetOrphans=true       set intransitQty to 0 on inventories that no
 *                           eligible PO contributes to (only runs when no PO
 *                           was skipped, so totals are trustworthy)
 */

const ELIGIBLE_INVOICE_STATUSES = ["Pending", "Partially-Invoiced"];

const SUCCESSFUL_GRN_FILTER = {
  status: "Confirmed",
  grnStatus: "success",
  grnDate: { $ne: null },
  grnNumber: { $exists: true, $nin: ["", null] },
};

const LOG_PREFIX = "[INTRANSIT-DEBUG]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const logError = (...args) => console.error(LOG_PREFIX, ...args);

const idString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const objectId = (value) => {
  const id = idString(value);
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

const numberValue = (value) => {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
};

const addQty = (map, key, qty) => map.set(key, (map.get(key) || 0) + qty);

const correctInventoryIntransitQty = async (req, res) => {
  const startedAt = new Date();

  const summary = {
    success: true,
    dryRun: false,
    purchaseOrdersFound: 0,
    purchaseOrdersProcessed: 0,
    purchaseOrdersSkipped: 0,
    skippedPurchaseOrders: [],
    skippedLines: [],
    warnings: [],
    inventoriesCalculated: 0,
    inventoriesUpdated: 0,
    inventoriesUnchanged: 0,
    inventoriesCreated: 0,
    inventoriesSkipped: 0,
    inventoriesReset: 0,
    poLinesLinked: 0,
    inventoryErrors: 0,
    inventoryResults: [],
  };

  try {
    if (!mongoose.connection.db) {
      throw new Error("MongoDB connection is not ready.");
    }

    const db = mongoose.connection.db;
    const poCollection = db.collection("purchaseorderentries");
    const invoiceCollection = db.collection("invoices");
    const inventoryCollection = db.collection("inventories");

    const dryRun = String(req?.query?.dryRun) === "true";
    const createMissing = String(req?.query?.createMissing) !== "false";
    const resetOrphans = String(req?.query?.resetOrphans) === "true";
    summary.dryRun = dryRun;

    const distributorId = req?.query?.distributorId
      ? objectId(req.query.distributorId)
      : null;

    if (req?.query?.distributorId && !distributorId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid distributorId." });
    }

    // Eligibility depends ONLY on invoicestatus.
    const poFilter = { invoicestatus: { $in: ELIGIBLE_INVOICE_STATUSES } };
    if (distributorId) poFilter.distributorId = distributorId;
    if (req?.query?.purchaseOrderNo) {
      poFilter.purchaseOrderNo = String(req.query.purchaseOrderNo);
    }

    log("Starting. Mode:", dryRun ? "DRY RUN" : "WRITE", poFilter);

    const purchaseOrders = await poCollection.find(poFilter).toArray();
    summary.purchaseOrdersFound = purchaseOrders.length;
    log(`Eligible purchase orders: ${purchaseOrders.length}`);

    // ------------------------------------------------------------------
    // Inventory resolution (cached)
    // ------------------------------------------------------------------
    const resolveCache = new Map();

    const resolveInventory = async (po, line, productId) => {
      const lineDistributorId =
        idString(line.distributorId) || idString(po.distributorId);
      const lineGodownId = idString(line.godownId) || idString(po.godownId);

      if (!objectId(lineDistributorId) || !objectId(lineGodownId)) {
        throw new Error(
          `missing distributor/godown for product ${productId}`
        );
      }

      const lineInventoryId = idString(line.inventoryId);
      const cacheKey = `${lineInventoryId}|${lineDistributorId}|${productId}|${lineGodownId}`;
      if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);

      let inventory = null;

      // 1) trust the line's inventoryId only if the mapping is correct
      const lineInvObjectId = objectId(lineInventoryId);
      if (lineInvObjectId) {
        const byId = await inventoryCollection.findOne({
          _id: lineInvObjectId,
        });
        if (
          byId &&
          idString(byId.productId) === productId &&
          idString(byId.distributorId) === lineDistributorId &&
          idString(byId.godownId) === lineGodownId
        ) {
          inventory = byId;
        } else if (byId) {
          summary.warnings.push(
            `PO ${po.purchaseOrderNo}: line inventory ${lineInventoryId} does not match product/distributor/godown; looked up by mapping instead.`
          );
        }
      }

      // 2) lookup by distributor + product + godown
      if (!inventory) {
        const matches = await inventoryCollection
          .find({
            distributorId: objectId(lineDistributorId),
            productId: objectId(productId),
            godownId: objectId(lineGodownId),
          })
          .toArray();

        if (matches.length > 1) {
          summary.warnings.push(
            `Duplicate inventories for product ${productId} in godown ${lineGodownId}: ${matches
              .map((m) => String(m._id))
              .join(", ")}. Using ${String(matches[0]._id)}.`
          );
        }
        inventory = matches[0] || null;
      }

      const result = {
        inventory,
        distributorId: lineDistributorId,
        godownId: lineGodownId,
        key: inventory
          ? String(inventory._id)
          : `NEW:${lineDistributorId}:${productId}:${lineGodownId}`,
      };

      resolveCache.set(cacheKey, result);
      return result;
    };

    /*
     * key -> {
     *   inventory, productId, distributorId, godownId,
     *   expectedQty, purchaseOrders[], lineLinks[]
     * }
     */
    const inventoryTotals = new Map();

    // ------------------------------------------------------------------
    // STEP 1: calculate pending qty per PO
    // ------------------------------------------------------------------
    for (const po of purchaseOrders) {
      const poNumber = po.purchaseOrderNo || String(po._id);

      try {
        if (!Array.isArray(po.lineItems) || po.lineItems.length === 0) {
          throw new Error("PO has no line items.");
        }

        // productId -> { orderedQty, line }
        const products = new Map();

        for (const [index, line] of po.lineItems.entries()) {
          const productId = idString(line.product);
          const orderedQty = numberValue(line.orderQty);

          // Bad lines are skipped individually, not the whole PO.
          if (!objectId(productId)) {
            summary.skippedLines.push({
              poNumber,
              line: index + 1,
              reason: "missing/invalid product",
            });
            continue;
          }

          if (!Number.isFinite(orderedQty) || orderedQty < 0) {
            summary.skippedLines.push({
              poNumber,
              line: index + 1,
              reason: `invalid orderQty ${line.orderQty}`,
            });
            continue;
          }

          // A foreclosed line is closed; nothing is in transit for it.
          if (line.foreclose === true) {
            continue;
          }

          const existing = products.get(productId);
          if (existing) {
            existing.orderedQty += orderedQty;
          } else {
            products.set(productId, { orderedQty, line, lineNo: index + 1 });
          }
        }

        if (products.size === 0) {
          throw new Error("PO has no valid line items.");
        }

        // Received qty from successful GRN invoices of this PO.
        const invoiceIds = Array.isArray(po.invoiceIds)
          ? po.invoiceIds.map(objectId).filter(Boolean)
          : [];

        const invoiceConditions = [
          { purchaseOrderId: po._id },
          { purchaseOrderId: String(po._id) },
        ];
        if (invoiceIds.length > 0) {
          invoiceConditions.push({ _id: { $in: invoiceIds } });
        }

        const invoices = await invoiceCollection
          .find({ ...SUCCESSFUL_GRN_FILTER, $or: invoiceConditions })
          .toArray();

        const uniqueInvoices = [
          ...new Map(invoices.map((i) => [String(i._id), i])).values(),
        ];

        const receivedByProduct = new Map();

        for (const invoice of uniqueInvoices) {
          if (!Array.isArray(invoice.lineItems)) {
            throw new Error(
              `Invoice ${invoice.invoiceNumber || invoice._id} has invalid lineItems.`
            );
          }

          for (const [i, line] of invoice.lineItems.entries()) {
            const productId = idString(line.product);
            if (!productId || !products.has(productId)) continue;

            const receivedQty = numberValue(line.receivedQty);
            if (!Number.isFinite(receivedQty) || receivedQty < 0) {
              throw new Error(
                `Invoice ${invoice.invoiceNumber || invoice._id}, line ${i + 1}: invalid receivedQty.`
              );
            }
            addQty(receivedByProduct, productId, receivedQty);
          }
        }

        // Build this PO's contribution locally; merge only if all succeeds.
        const contributions = [];

        for (const [productId, info] of products) {
          const receivedQty = receivedByProduct.get(productId) || 0;
          const pendingQty = Math.max(0, info.orderedQty - receivedQty);

          const resolved = await resolveInventory(po, info.line, productId);

          log("PO calc:", {
            poNumber,
            productId,
            orderedQty: info.orderedQty,
            receivedQty,
            pendingQty,
            inventory: resolved.key,
          });

          contributions.push({ productId, info, pendingQty, resolved });
        }

        for (const c of contributions) {
          const { resolved, productId, info, pendingQty } = c;
          let total = inventoryTotals.get(resolved.key);

          if (!total) {
            total = {
              inventory: resolved.inventory,
              productId,
              distributorId: resolved.distributorId,
              godownId: resolved.godownId,
              expectedQty: 0,
              purchaseOrders: [],
              lineLinks: [],
            };
            inventoryTotals.set(resolved.key, total);
          }

          total.expectedQty += pendingQty;
          if (!total.purchaseOrders.includes(poNumber)) {
            total.purchaseOrders.push(poNumber);
          }

          // Remember PO lines whose inventoryId must be written/corrected.
          const currentLineInvId = idString(info.line.inventoryId);
          const resolvedInvId = resolved.inventory
            ? String(resolved.inventory._id)
            : null;

          if (!resolvedInvId || currentLineInvId !== resolvedInvId) {
            total.lineLinks.push({
              poId: po._id,
              lineId: info.line._id,
              poNumber,
            });
          }
        }

        summary.purchaseOrdersProcessed += 1;
      } catch (error) {
        summary.purchaseOrdersSkipped += 1;
        summary.skippedPurchaseOrders.push({
          purchaseOrderNo: poNumber,
          purchaseOrderId: String(po._id),
          reason: error.message,
        });
        logError(`Skipping PO ${poNumber}:`, error.message);
      }
    }

    summary.inventoriesCalculated = inventoryTotals.size;

    // ------------------------------------------------------------------
    // STEP 2: apply to inventories
    // ------------------------------------------------------------------
    const linkPoLines = async (inventoryObjectId, lineLinks) => {
      for (const link of lineLinks) {
        if (!link.lineId) continue;
        const r = await poCollection.updateOne(
          { _id: link.poId },
          { $set: { "lineItems.$[l].inventoryId": inventoryObjectId } },
          { arrayFilters: [{ "l._id": link.lineId }] }
        );
        if (r.modifiedCount === 1) summary.poLinesLinked += 1;
      }
    };

    for (const [key, expected] of inventoryTotals) {
      try {
        let inventory = expected.inventory;

        // ---- inventory does not exist yet ----
        if (!inventory) {
          if (!createMissing || expected.expectedQty <= 0) {
            summary.inventoriesSkipped += 1;
            summary.inventoryResults.push({
              key,
              action: "MISSING_INVENTORY_NOT_CREATED",
              expectedQty: expected.expectedQty,
            });
            continue;
          }

          if (dryRun) {
            summary.inventoriesCreated += 1;
            summary.inventoryResults.push({
              key,
              action: "WOULD_CREATE",
              expectedQty: expected.expectedQty,
              purchaseOrders: expected.purchaseOrders,
            });
            continue;
          }

          const now = new Date();
          const doc = {
            productId: objectId(expected.productId),
            distributorId: objectId(expected.distributorId),
            godownId: objectId(expected.godownId),
            invitemId: await generateCode("INVT"),
            intransitQty: expected.expectedQty,
            undeliveredQty: 0,
            damagedQty: 0,
            availableQty: 0,
            reservedQty: 0,
            unsalableQty: 0,
            offerQty: 0,
            totalQty: 0,
            totalStockamtDlp: 0,
            totalStockamtRlp: 0,
            totalUnsalableamtDlp: 0,
            totalUnsalableStockamtRlp: 0,
            normsQty: 0,
            godownType: "main",
            openingStock: false,
            createdAt: now,
            updatedAt: now,
            __v: 0,
          };

          const inserted = await inventoryCollection.insertOne(doc);
          await linkPoLines(inserted.insertedId, expected.lineLinks);

          summary.inventoriesCreated += 1;
          summary.inventoryResults.push({
            key,
            action: "CREATED",
            inventoryId: String(inserted.insertedId),
            intransitQty: expected.expectedQty,
            purchaseOrders: expected.purchaseOrders,
          });
          continue;
        }

        // ---- inventory exists ----
        const currentQty = Number(inventory.intransitQty ?? 0);
        const inventoryObjectId = inventory._id;

        if (currentQty === expected.expectedQty) {
          if (!dryRun) await linkPoLines(inventoryObjectId, expected.lineLinks);
          summary.inventoriesUnchanged += 1;
          summary.inventoryResults.push({
            key,
            action: "UNCHANGED",
            currentQty,
          });
          continue;
        }

        if (dryRun) {
          summary.inventoriesUpdated += 1;
          summary.inventoryResults.push({
            key,
            action: "WOULD_UPDATE",
            previousQty: currentQty,
            updatedQty: expected.expectedQty,
            purchaseOrders: expected.purchaseOrders,
          });
          continue;
        }

        const updateResult = await inventoryCollection.updateOne(
          {
            _id: inventoryObjectId,
            productId: inventory.productId,
            distributorId: inventory.distributorId,
            godownId: inventory.godownId,
          },
          {
            $set: {
              intransitQty: expected.expectedQty,
              updatedAt: new Date(),
            },
          }
        );

        if (updateResult.matchedCount !== 1) {
          summary.inventoriesSkipped += 1;
          summary.inventoryResults.push({ key, action: "UPDATE_NOT_MATCHED" });
          continue;
        }

        const check = await inventoryCollection.findOne({
          _id: inventoryObjectId,
        });
        const verifiedQty = check ? Number(check.intransitQty) : NaN;

        if (verifiedQty === expected.expectedQty) {
          await linkPoLines(inventoryObjectId, expected.lineLinks);
          summary.inventoriesUpdated += 1;
          summary.inventoryResults.push({
            key,
            action: "UPDATED_AND_VERIFIED",
            previousQty: currentQty,
            updatedQty: verifiedQty,
            purchaseOrders: expected.purchaseOrders,
          });
        } else {
          summary.inventoryErrors += 1;
          summary.inventoryResults.push({
            key,
            action: "UPDATE_VERIFICATION_FAILED",
            expectedQty: expected.expectedQty,
            actualQty: verifiedQty,
          });
        }
      } catch (error) {
        summary.inventoryErrors += 1;
        summary.inventoryResults.push({
          key,
          action: "ERROR",
          message: error.message,
        });
        logError(`Inventory ${key} failed:`, error.message);
      }
    }

    // ------------------------------------------------------------------
    // STEP 3 (optional): zero out stale in-transit on untouched inventories
    // ------------------------------------------------------------------
    if (resetOrphans) {
      if (summary.purchaseOrdersSkipped > 0 || req?.query?.purchaseOrderNo) {
        summary.warnings.push(
          "resetOrphans ignored: it only runs when no PO was skipped and no single-PO filter is used."
        );
      } else {
        const touchedIds = [...inventoryTotals.values()]
          .filter((t) => t.inventory)
          .map((t) => t.inventory._id);

        const orphanFilter = {
          intransitQty: { $nin: [0, null] },
          _id: { $nin: touchedIds },
        };
        if (distributorId) orphanFilter.distributorId = distributorId;

        const orphans = await inventoryCollection
          .find(orphanFilter)
          .project({ _id: 1, intransitQty: 1 })
          .toArray();

        for (const orphan of orphans) {
          if (!dryRun) {
            await inventoryCollection.updateOne(
              { _id: orphan._id },
              { $set: { intransitQty: 0, updatedAt: new Date() } }
            );
          }
          summary.inventoriesReset += 1;
          summary.inventoryResults.push({
            key: String(orphan._id),
            action: dryRun ? "WOULD_RESET_TO_ZERO" : "RESET_TO_ZERO",
            previousQty: orphan.intransitQty,
          });
        }
      }
    }

    summary.finishedAt = new Date();
    summary.durationMs = summary.finishedAt.getTime() - startedAt.getTime();

    log("DONE", JSON.stringify({ ...summary, inventoryResults: undefined }));

    return res.status(200).json({
      success: true,
      message: dryRun
        ? "Dry run completed. Nothing was written."
        : "In-transit quantities synced from pending purchase orders.",
      summary,
    });
  } catch (error) {
    logError("Fatal error:", error);
    return res.status(500).json({
      success: false,
      message: "In-transit sync failed.",
      error: error.message,
      summary,
    });
  }
};

module.exports = { correctInventoryIntransitQty };