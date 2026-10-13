const mongoose = require("mongoose");

const ELIGIBLE_INVOICE_STATUSES = [
  "Pending",
  "Partially-Invoiced",
];

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

  if (typeof value === "object" && value._id) {
    return String(value._id);
  }

  return String(value);
};

const objectId = (value) => {
  const id = idString(value);

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  return new mongoose.Types.ObjectId(id);
};

const numberValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }

  return Number(value);
};

const addQty = (map, key, qty) => {
  map.set(key, (map.get(key) || 0) + qty);
};

const correctInventoryIntransitQty = async (req, res) => {
  const startedAt = new Date();

  const summary = {
    success: true,
    purchaseOrdersFound: 0,
    purchaseOrdersProcessed: 0,
    purchaseOrdersSkipped: 0,
    inventoriesCalculated: 0,
    inventoriesUpdated: 0,
    inventoriesUnchanged: 0,
    inventoriesSkipped: 0,
    inventoryErrors: 0,
    skippedPurchaseOrders: [],
    inventoryResults: [],
  };

  try {
    if (!mongoose.connection.db) {
      throw new Error("MongoDB connection is not ready.");
    }

    const db = mongoose.connection.db;

    // Native MongoDB collections; no Mongoose model writes.
    const poCollection = db.collection("purchaseorderentries");
    const invoiceCollection = db.collection("invoices");
    const inventoryCollection = db.collection("inventories");

    const distributorId = req?.query?.distributorId
      ? objectId(req.query.distributorId)
      : null;

    if (req?.query?.distributorId && !distributorId) {
      return res.status(400).json({
        success: false,
        message: "Invalid distributorId.",
      });
    }

    // IMPORTANT:
    // Eligibility is based ONLY on invoicestatus, not PO status.
    const poFilter = {
      invoicestatus: {
        $in: ELIGIBLE_INVOICE_STATUSES,
      },
    };

    if (distributorId) {
      poFilter.distributorId = distributorId;
    }

    log("Starting inventory reconciliation.");
    log("Eligible PO filter:", poFilter);

    // Only Pending and Partially-Invoiced POs are loaded.
    const purchaseOrders = await poCollection
      .find(poFilter)
      .toArray();

    summary.purchaseOrdersFound = purchaseOrders.length;

    log(`Eligible purchase orders found: ${purchaseOrders.length}`);

    /*
     * Global totals:
     *
     * inventoryId -> {
     *   expectedQty,
     *   productId,
     *   distributorId,
     *   godownId,
     *   purchaseOrders
     * }
     *
     * Failed POs never contribute to these totals.
     */
    const inventoryTotals = new Map();

    // ------------------------------------------------------------
    // STEP 1: PROCESS PURCHASE ORDERS ONE BY ONE
    // ------------------------------------------------------------

    for (const po of purchaseOrders) {
      const poNumber = po.purchaseOrderNo || String(po._id);

      log("--------------------------------------------");
      log(`Processing PO: ${poNumber}`);
      log("PO invoicestatus:", po.invoicestatus);

      try {
        if (
          !Array.isArray(po.lineItems) ||
          po.lineItems.length === 0
        ) {
          throw new Error("PO has no line items.");
        }

        /*
         * Local data only.
         * Nothing is merged into global totals until this PO
         * has passed validation completely.
         */
        const orderedByProduct = new Map();
        const metadataByProduct = new Map();
        const receivedByProduct = new Map();
        const localInventoryTotals = new Map();

        // Validate PO line items.
        for (const [index, line] of po.lineItems.entries()) {
          const productId = idString(line.product);
          const inventoryId = idString(line.inventoryId);
          const orderedQty = numberValue(line.orderQty);

          if (!productId) {
            throw new Error(
              `Line ${index + 1}: missing product reference.`
            );
          }

          if (!objectId(inventoryId)) {
            throw new Error(
              `Line ${index + 1}: invalid inventoryId ${inventoryId}.`
            );
          }

          if (
            !Number.isFinite(orderedQty) ||
            orderedQty < 0
          ) {
            throw new Error(
              `Line ${index + 1}: invalid orderQty ${line.orderQty}.`
            );
          }

          const previous = metadataByProduct.get(productId);

          // A single product must map to one inventory within this PO.
          if (previous && previous.inventoryId !== inventoryId) {
            throw new Error(
              `Product ${productId} maps to multiple inventory IDs.`
            );
          }

          const lineDistributorId =
            idString(line.distributorId) ||
            idString(po.distributorId);

          const lineGodownId =
            idString(line.godownId) ||
            idString(po.godownId);

          if (
            previous &&
            (
              previous.distributorId !== lineDistributorId ||
              previous.godownId !== lineGodownId
            )
          ) {
            throw new Error(
              `Inconsistent distributor/godown mapping for product ${productId}.`
            );
          }

          metadataByProduct.set(productId, {
            productId,
            inventoryId,
            distributorId: lineDistributorId,
            godownId: lineGodownId,
          });

          addQty(orderedByProduct, productId, orderedQty);
        }

        // --------------------------------------------------------
        // Find successful GRN invoices linked to this PO.
        // Supports ObjectId or string purchaseOrderId references.
        // --------------------------------------------------------

        const invoiceIds = Array.isArray(po.invoiceIds)
          ? po.invoiceIds
              .map(objectId)
              .filter(Boolean)
          : [];

        const invoiceConditions = [
          { purchaseOrderId: po._id },
          { purchaseOrderId: String(po._id) },
        ];

        if (invoiceIds.length > 0) {
          invoiceConditions.push({
            _id: { $in: invoiceIds },
          });
        }

        const invoices = await invoiceCollection
          .find({
            ...SUCCESSFUL_GRN_FILTER,
            $or: invoiceConditions,
          })
          .toArray();

        // Deduplicate invoices.
        const uniqueInvoices = [
          ...new Map(
            invoices.map((invoice) => [
              String(invoice._id),
              invoice,
            ])
          ).values(),
        ];

        log(
          `Successful GRN invoices for ${poNumber}: ${uniqueInvoices.length}`
        );

        // Sum received quantities for products present in this PO.
        for (const invoice of uniqueInvoices) {
          log("Reading GRN invoice:", {
            invoiceId: String(invoice._id),
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            grnStatus: invoice.grnStatus,
            grnNumber: invoice.grnNumber,
          });

          if (!Array.isArray(invoice.lineItems)) {
            throw new Error(
              `Invoice ${invoice.invoiceNumber || invoice._id} has invalid lineItems.`
            );
          }

          for (const [index, line] of invoice.lineItems.entries()) {
            const productId = idString(line.product);

            // Ignore products that do not belong to this PO.
            if (!productId || !orderedByProduct.has(productId)) {
              continue;
            }

            const receivedQty = numberValue(line.receivedQty);

            if (
              !Number.isFinite(receivedQty) ||
              receivedQty < 0
            ) {
              throw new Error(
                `Invoice ${invoice.invoiceNumber || invoice._id}, ` +
                `line ${index + 1}: invalid receivedQty.`
              );
            }

            addQty(receivedByProduct, productId, receivedQty);
          }
        }

        // --------------------------------------------------------
        // Calculate pending quantity for this PO.
        // Uses orderQty directly; does not multiply boxOrderQty.
        // --------------------------------------------------------

        for (const [productId, orderedQty] of orderedByProduct) {
          const receivedQty =
            receivedByProduct.get(productId) || 0;

          const pendingQty = Math.max(
            0,
            orderedQty - receivedQty
          );

          const metadata = metadataByProduct.get(productId);
          const inventoryId = metadata.inventoryId;

          log("PO quantity calculation:", {
            poNumber,
            productId,
            inventoryId,
            orderedQty,
            receivedQty,
            pendingQty,
          });

          const existing = localInventoryTotals.get(inventoryId);

          if (existing) {
            existing.expectedQty += pendingQty;
          } else {
            localInventoryTotals.set(inventoryId, {
              expectedQty: pendingQty,
              productId: metadata.productId,
              distributorId: metadata.distributorId,
              godownId: metadata.godownId,
            });
          }
        }

        /*
         * Validate every possible global mapping conflict BEFORE
         * changing global totals. This prevents a failed PO from
         * partially contributing quantities.
         */
        for (const [inventoryId, local] of localInventoryTotals) {
          const global = inventoryTotals.get(inventoryId);

          if (
            global &&
            (
              global.productId !== local.productId ||
              (
                global.distributorId &&
                local.distributorId &&
                global.distributorId !== local.distributorId
              ) ||
              (
                global.godownId &&
                local.godownId &&
                global.godownId !== local.godownId
              )
            )
          ) {
            throw new Error(
              `Conflicting mapping for inventory ${inventoryId}.`
            );
          }
        }

        // Merge this PO only after all validations pass.
        for (const [inventoryId, local] of localInventoryTotals) {
          const global = inventoryTotals.get(inventoryId);

          if (global) {
            global.expectedQty += local.expectedQty;

            if (
              !global.distributorId &&
              local.distributorId
            ) {
              global.distributorId = local.distributorId;
            }

            if (!global.godownId && local.godownId) {
              global.godownId = local.godownId;
            }

            if (!global.purchaseOrders.includes(poNumber)) {
              global.purchaseOrders.push(poNumber);
            }
          } else {
            inventoryTotals.set(inventoryId, {
              expectedQty: local.expectedQty,
              productId: local.productId,
              distributorId: local.distributorId,
              godownId: local.godownId,
              purchaseOrders: [poNumber],
            });
          }
        }

        summary.purchaseOrdersProcessed += 1;

        log(`PO validated successfully: ${poNumber}`);
      } catch (error) {
        summary.purchaseOrdersSkipped += 1;

        summary.skippedPurchaseOrders.push({
          purchaseOrderNo: poNumber,
          purchaseOrderId: String(po._id),
          reason: error.message,
        });

        logError(
          `Skipping PO ${poNumber}; continuing to next PO:`,
          error.message
        );

        // Skip this PO only.
        continue;
      }
    }

    summary.inventoriesCalculated = inventoryTotals.size;

    log("--------------------------------------------");
    log("PO processing completed.", {
      found: summary.purchaseOrdersFound,
      processed: summary.purchaseOrdersProcessed,
      skipped: summary.purchaseOrdersSkipped,
      inventoryRecords: summary.inventoriesCalculated,
    });

    // ------------------------------------------------------------
    // STEP 2: UPDATE INVENTORIES ONE BY ONE
    // ------------------------------------------------------------

    for (const [inventoryId, expected] of inventoryTotals) {
      log("--------------------------------------------");
      log(`Checking inventory: ${inventoryId}`);

      log("Expected quantity:", expected.expectedQty);
      log("Contributing valid POs:", expected.purchaseOrders);

      try {
        const inventoryObjectId = objectId(inventoryId);

        if (!inventoryObjectId) {
          summary.inventoriesSkipped += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "INVALID_INVENTORY_ID",
          });

          logError("Invalid inventory ID:", inventoryId);
          continue;
        }

        const inventory = await inventoryCollection.findOne({
          _id: inventoryObjectId,
        });

        if (!inventory) {
          summary.inventoriesSkipped += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "MISSING_INVENTORY",
          });

          logError("Inventory not found:", inventoryId);
          continue;
        }

        const actualProductId = idString(inventory.productId);
        const actualDistributorId = idString(
          inventory.distributorId
        );
        const actualGodownId = idString(inventory.godownId);

        log("Database inventory before update:", {
          inventoryId,
          productId: actualProductId,
          distributorId: actualDistributorId,
          godownId: actualGodownId,
          intransitQty: inventory.intransitQty,
        });

        // Never update a record whose mapping does not match.
        const mappingErrors = [];

        if (actualProductId !== expected.productId) {
          mappingErrors.push({
            field: "productId",
            expected: expected.productId,
            actual: actualProductId,
          });
        }

        if (
          expected.distributorId &&
          actualDistributorId !== expected.distributorId
        ) {
          mappingErrors.push({
            field: "distributorId",
            expected: expected.distributorId,
            actual: actualDistributorId,
          });
        }

        if (
          expected.godownId &&
          actualGodownId !== expected.godownId
        ) {
          mappingErrors.push({
            field: "godownId",
            expected: expected.godownId,
            actual: actualGodownId,
          });
        }

        if (mappingErrors.length > 0) {
          summary.inventoriesSkipped += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "MAPPING_MISMATCH",
            mappingErrors,
          });

          logError("Mapping mismatch; inventory skipped:", mappingErrors);
          continue;
        }

        const currentQty = Number(inventory.intransitQty ?? 0);

        if (currentQty === expected.expectedQty) {
          summary.inventoriesUnchanged += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "UNCHANGED",
            currentQty,
            expectedQty: expected.expectedQty,
          });

          log("No update needed; quantity already matches.", {
            inventoryId,
            currentQty,
          });

          continue;
        }

        log("Updating inventory:", {
          inventoryId,
          from: currentQty,
          to: expected.expectedQty,
        });

        /*
         * Conditional write: mapping must still match the document
         * read above. A concurrent change causes this update to skip.
         */
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
            },
          }
        );

        if (updateResult.matchedCount !== 1) {
          summary.inventoriesSkipped += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "UPDATE_NOT_MATCHED",
          });

          logError(
            "Inventory changed before update; skipped:",
            inventoryId
          );

          continue;
        }

        // Read back the document to verify the database write.
        const updatedInventory = await inventoryCollection.findOne({
          _id: inventoryObjectId,
        });

        const verifiedQty = updatedInventory
          ? Number(updatedInventory.intransitQty)
          : NaN;

        if (verifiedQty === expected.expectedQty) {
          summary.inventoriesUpdated += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "UPDATED_AND_VERIFIED",
            previousQty: currentQty,
            updatedQty: verifiedQty,
            contributingPurchaseOrders: expected.purchaseOrders,
          });

          log("Update successfully verified:", {
            inventoryId,
            previousQty: currentQty,
            updatedQty: verifiedQty,
          });
        } else {
          summary.inventoryErrors += 1;

          summary.inventoryResults.push({
            inventoryId,
            action: "UPDATE_VERIFICATION_FAILED",
            expectedQty: expected.expectedQty,
            actualQty: verifiedQty,
          });

          logError("Update verification failed:", {
            inventoryId,
            expectedQty: expected.expectedQty,
            actualQty: verifiedQty,
          });
        }
      } catch (error) {
        summary.inventoryErrors += 1;

        summary.inventoryResults.push({
          inventoryId,
          action: "ERROR",
          message: error.message,
        });

        logError(
          `Inventory ${inventoryId} failed; continuing to next inventory:`,
          error.message
        );

        // Skip this inventory only.
        continue;
      }
    }

    summary.finishedAt = new Date();
    summary.durationMs =
      summary.finishedAt.getTime() - startedAt.getTime();

    log("FINAL SUMMARY:");
    log(JSON.stringify(summary, null, 2));

    return res.status(200).json({
      success: true,
      message:
        "Reconciliation completed. Only eligible POs were processed. " +
        "Failed POs and inventory records were skipped independently.",
      summary,
    });
  } catch (error) {
    logError("Fatal reconciliation error:", error);

    return res.status(500).json({
      success: false,
      message: "Inventory reconciliation failed.",
      error: error.message,
      summary,
    });
  }
};

module.exports = {
  correctInventoryIntransitQty,
};