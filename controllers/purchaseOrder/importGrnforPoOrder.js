const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const moment = require("moment");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");

const Transaction = require("../../models/transaction.model");
const Inventory = require("../../models/inventory.model");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");

const {
  createStockLedgerEntry,
} = require("../../controllers/transction/createStockLedgerEntry");

const {
  updatePrimaryTargetAchievement,
} = require("../bill/util/updatePrimaryTargetAchievement.js");

const {
  transactionCode,
  generateCode,
} = require("../../utils/codeGenerator");

/**
 * SO numbers are typed/pasted by hand into two different CSV uploads (the
 * bulk PO create sheet and this GRN sheet), so stray leading/trailing
 * whitespace (very common from Excel exports) or a casing slip between
 * the two is common. Bulk PO creation already trims `so_number` before
 * saving it onto lineItems — this GRN import must normalize the same way
 * before grouping/querying, or an SO that genuinely exists will fail an
 * exact-match lookup and surface as "SO Number not found".
 */
const normalizeSoNumber = (value) => String(value || "").trim();

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sentinel key used to bucket CSV rows that don't carry an explicit
 * Invoice Number. All such rows for a given SO still share ONE
 * auto-generated invoice/GRN, exactly like before. Rows that DO specify
 * an Invoice Number are grouped by that exact (trimmed) number instead,
 * so the same SO can now be split across several invoices/GRNs.
 */
const AUTO_INVOICE_KEY = "__AUTO__";

// =========================
// 📦 IN-TRANSIT HELPERS
// =========================

// Read-only check: current in-transit qty (null = no inventory doc)
const getIntransitAvailable = async (filter) => {
  const inv = await Inventory.findOne(filter).select("intransitQty").lean();
  return inv ? Number(inv.intransitQty || 0) : null;
};

// Atomic deduct: only succeeds if intransitQty >= qty. Returns null if it fails.
const deductIntransit = (filter, qty) =>
  Inventory.findOneAndUpdate(
    { ...filter, intransitQty: { $gte: qty } },
    { $inc: { intransitQty: -qty } },
    { new: true }
  );

// Used for rollback
const addBackIntransit = (filter, qty) =>
  Inventory.findOneAndUpdate(
    filter,
    { $inc: { intransitQty: qty } },
    { new: true }
  );

// Validate BEFORE touching anything.
// entries: [{ filter, qty, name, productCode }]
// Returns [{ productCode, reason }] (empty = all good)
const validateIntransit = async (entries) => {
  // merge duplicate products so totals are checked correctly
  const merged = new Map();
  for (const e of entries) {
    const key = JSON.stringify(e.filter);
    if (merged.has(key)) {
      merged.get(key).qty += e.qty;
    } else {
      merged.set(key, { ...e });
    }
  }

  const errors = [];
  for (const e of merged.values()) {
    if (e.qty <= 0) continue;
    const available = await getIntransitAvailable(e.filter);

    if (available === null) {
      errors.push({
        productCode: e.productCode,
        reason: `${e.name}: inventory record not found`,
      });
    } else if (available < e.qty) {
      errors.push({
        productCode: e.productCode,
        reason: `${e.name}: insufficient in-transit qty (available ${available}, required ${e.qty})`,
      });
    }
  }
  return errors;
};

// Deduct all entries; if any fails (e.g. race condition), roll back the ones done.
const deductAllOrRollback = async (entries) => {
  const done = [];

  for (const e of entries) {
    if (e.qty <= 0) continue;

    const updated = await deductIntransit(e.filter, e.qty);

    if (!updated) {
      for (const d of done) {
        await addBackIntransit(d.filter, d.qty);
      }
      return {
        ok: false,
        message: `${e.name}: insufficient in-transit qty to deduct ${e.qty}`,
      };
    }

    done.push(e);
  }

  return { ok: true };
};

const rollbackAll = async (entries) => {
  for (const e of entries) {
    if (e.qty > 0) {
      try {
        await addBackIntransit(e.filter, e.qty);
      } catch (rbErr) {
        console.error("In-transit rollback failed:", rbErr.message);
      }
    }
  }
};

/**
 * 🔁 Merge duplicate product rows
 */
const mergeLineItems = (items) => {
  const map = {};

  for (const item of items) {
    const key = String(item.productCode).trim();

    if (!map[key]) {
      map[key] = { ...item };
    } else {
      map[key].orderQty += item.orderQty;
    }
  }

  return Object.values(map);
};

/**
 * 🔢 Generate GRN Number
 */
const generateGRNNumber = async () => {
  const year = new Date().getFullYear().toString().slice(-2);

  const lastInvoice = await Invoice.findOne({
    grnNumber: { $regex: `^GRN-${year}` },
  })
    .sort({ createdAt: -1 })


  let nextSequence = 1;

  if (lastInvoice?.grnNumber) {
    const lastNumber = lastInvoice.grnNumber.split("-")[1];
    const lastSeq = Number(lastNumber.slice(2));
    nextSequence = lastSeq + 1;
  }

  return `GRN-${year}${String(nextSequence).padStart(5, "0")}`;
};

/**
 * 🔥 Generate Invoice Number
 */
const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear().toString().slice(-2);

  const lastInvoice = await Invoice.findOne({
    invoiceNo: { $regex: `^INV-${year}` },
  })
    .sort({ createdAt: -1 })

  let nextSequence = 1;

  if (lastInvoice?.invoiceNo) {
    const lastNumber = lastInvoice.invoiceNo.split("-")[1];
    const lastSeq = Number(lastNumber.slice(2));
    nextSequence = lastSeq + 1;
  }

  return `INV-${year}${String(nextSequence).padStart(5, "0")}`;
};

/**
 * 🔥 STOCK + TRANSACTION + LEDGER + REWARD
 *
 * Inventory is godown-scoped (godownId is a required field on the
 * Inventory schema), so stock for this GRN must land in the SAME godown
 * the purchase order was raised against — never a bare
 * `godownType: "main"` lookup across the whole distributor, which would
 * either miss the right doc or fail Inventory's required-field
 * validation when creating a new one.
 *
 * NOTE: in-transit qty is NOT touched here anymore. It is reserved
 * (deducted atomically, never below 0) in generateGRNForPO BEFORE the
 * invoice is created. If an item fails here before its stock was saved,
 * its reserved in-transit qty is added back.
 */
const processInvoiceAdjustments = async ({
  invoice,
  godownId,
}) => {

  const distributorId = invoice.distributorId;

  const distributor = await Distributor.findById(distributorId);

  const stockId = await transactionCode("LXSTA");

  const stockSummary = [];
  const stockAdjustmentErrors = [];

  for (const item of invoice.lineItems) {

    if (item.receivedQty <= 0) {
      continue;
    }

    // true once inventory.save() succeeded (stock really moved)
    let stockSaved = false;

    try {

      /**
       * ✅ Prevent duplicate transaction
       */
      const existingTxn = await Transaction.findOne({
        invoiceId: invoice._id,
        invoiceLineItemId: item._id,
        transactionType: "invoice",
      });

      if (existingTxn) {
        continue;
      }

      /**
       * ✅ Product
       */
      const product = await Product.findById(
        item.product
      );

      if (!product) {
        throw new Error("Product not found");
      }

      /**
       * ✅ Price — 3-tier fallback: distributor-specific -> regional
       * (scoped by the distributor's OWN regionId) -> national.
       */
      let priceEntry = await Price.findOne({
        productId: item.product,
        distributorId,
        status: true,
      })
        .sort({ createdAt: -1 });

      if (!priceEntry && distributor?.regionId) {
        priceEntry = await Price.findOne({
          productId: item.product,
          price_type: "regional",
          regionId: distributor.regionId,
          status: true,
        })
          .sort({ createdAt: -1 });
      }

      if (!priceEntry) {
        priceEntry = await Price.findOne({
          productId: item.product,
          price_type: "national",
          status: true,
        })
          .sort({ createdAt: -1 });
      }

      if (!priceEntry) {
        throw new Error(
          `Price not found for ${product.name}`
        );
      }

      /**
       * ✅ RLP/DLP (per single piece)
       *
       * dlp_price/rlp_price on the Price doc are stored at the UOM level
       * (per box, per bundle, etc). For "box" UOM we divide down to a
       * per-piece rate using no_of_pieces_in_a_box; every other UOM is
       * already effectively 1 piece per unit, so the raw price is used
       * as-is.
       */
      let rlpbyPcs = 0;
      let dlpbyPcs = 0;

      if (product.uom === "box") {

        const piecesPerBox =
          Number(product.no_of_pieces_in_a_box) || 1;

        rlpbyPcs =
          Number(priceEntry.rlp_price || 0) /
          piecesPerBox;

        dlpbyPcs =
          Number(priceEntry.dlp_price || 0) /
          piecesPerBox;

      } else {

        rlpbyPcs = Number(priceEntry.rlp_price || 0);

        dlpbyPcs = Number(priceEntry.dlp_price || 0);
      }

      /**
       * ✅ Inventory — scoped to this PO's godown
       */
      let inventory = await Inventory.findOne({
        productId: item.product,
        distributorId,
        godownId,
      });

      if (!inventory) {

        const inventoryItemId =
          await generateCode("INVT");

        inventory = new Inventory({
          productId: item.product,
          distributorId,
          godownId,
          invitemId: inventoryItemId,
          availableQty: 0,
          damagedQty: 0,
          totalStockamtDlp: 0,
          totalStockamtRlp: 0,
          godownType: "main",
        });
      }

      /**
       * ✅ Update Inventory
       */
      inventory.availableQty += Number(
        item.receivedQty || 0
      );

      inventory.damagedQty += Number(
        item.damageQty || 0
      );

      /**
       * totalStockamtDlp/totalStockamtRlp represent the CURRENT value of
       * stock on hand — availableQty * price-per-piece — not a running
       * sum of per-receipt (qty * price-at-that-time) amounts.
       */
      inventory.totalStockamtDlp =
        inventory.availableQty * dlpbyPcs;

      inventory.totalStockamtRlp =
        inventory.availableQty * rlpbyPcs;

      // intransitQty was already deducted (atomically) before the invoice
      // was created, so it is intentionally not modified here.

      await inventory.save();
      stockSaved = true;

      stockSummary.push({
        product: item.product,
        productCode: product.product_code,
        productName: product.name,
        receivedQty: Number(item.receivedQty || 0),
        availableQty: inventory.availableQty,
        intransitQty: inventory.intransitQty,
        dlpRatePerPc: dlpbyPcs,
        rlpRatePerPc: rlpbyPcs,
        totalStockamtDlp: inventory.totalStockamtDlp,
        totalStockamtRlp: inventory.totalStockamtRlp,
      });

      /**
       * ✅ Transaction
       */
      const transaction = await Transaction.create(
        [
          {
            distributorId,
            productId: item.product,
            invItemId: inventory._id,
            transactionId: stockId,
            qty: item.receivedQty,
            date: new Date(),
            type: "In",
            balanceCount: inventory.availableQty,
            description: `Invoice ${invoice.invoiceNo} - Stock received`,
            transactionType: "invoice",
            stockType: "salable",
            invoiceId: invoice._id,
            invoiceLineItemId: item._id,
            billLineItemId: null,
          },
        ],
      );

      /**
       * ✅ Stock Ledger
       */
      try {

        await createStockLedgerEntry(
          transaction[0]._id
        );

      } catch (ledgerError) {

        console.log(
          "Stock ledger error:",
          ledgerError.message
        );
      }

    } catch (itemError) {
      console.error(
        `Stock adjustment failed for product ${item.product} on invoice ${invoice.invoiceNo}:`,
        itemError.message
      );

      // Stock never landed for this item -> give back the in-transit qty
      // that was reserved for it, so it isn't lost.
      if (!stockSaved) {
        try {
          await addBackIntransit(
            {
              distributorId,
              productId: item.product,
              godownId,
            },
            Number(item.receivedQty || 0)
          );
        } catch (rbErr) {
          console.error("In-transit add-back failed:", rbErr.message);
        }
      }

      stockAdjustmentErrors.push({
        product: item.product,
        receivedQty: Number(item.receivedQty || 0),
        error: itemError.message,
      });
    }
  }

  /**
   * ===================================
   * 🎁 REWARD POINTS
   * ===================================
   */
  if (
    distributor &&
    distributor.RBPSchemeMapped === "yes"
  ) {

    const existingGRN =
      await DistributorTransaction.findOne({
        invoiceId: invoice._id,
        transactionFor: "GRN",
        status: "Success",
      });

    if (!existingGRN) {

      let rewardPoints = 0;

      for (const li of invoice.lineItems) {

        const product = await Product.findById(
          li.product
        );

        const basePoint = Number(
          li.usedBasePoint ??
          product?.base_point ??
          0
        );

        if (basePoint > 0) {

          rewardPoints +=
            basePoint * Number(li.receivedQty || 0);
        }
      }

      if (rewardPoints > 0) {

        const latestTxn =
          await DistributorTransaction.findOne({
            distributorId,
          })
            .sort({ createdAt: -1 });

        const balance = latestTxn
          ? Number(latestTxn.balance || 0) +
          rewardPoints
          : rewardPoints;

        await DistributorTransaction.create(
          [
            {
              distributorId,
              transactionType: "credit",
              transactionFor: "GRN",
              point: rewardPoints,
              balance,
              invoiceId: invoice._id,
              status: "Success",
              remark: `Reward points for GRN ${invoice.grnNumber} with invoice no ${invoice.invoiceNo}`,
            },
          ],
        );
      }
    }
  }

  /**
   * ===================================
   * 🎯 TARGET ACHIEVEMENT
   * ===================================
   */

  await updatePrimaryTargetAchievement({

    distributorId: distributorId,

    invoiceId: invoice._id,

    billDate: invoice.createdAt,

    totalBillValue:
      invoice.totalInvoiceAmount,

    lineItems: invoice.lineItems,
  });

  return { stockSummary, stockAdjustmentErrors };
};

/**
 * 🔥 CORE GRN CREATION
 *
 * `soNumber` is the SO key this whole GRN batch belongs to (the caller
 * already grouped the uploaded rows by it — already normalized via
 * normalizeSoNumber, see importGrnforPoOrder below). It's used to:
 *   - pick the right lineItem on `purchaseOrder` when a PO happens to mix
 *     items from more than one soNumber (matches by product AND soNumber
 *     when the PO item has one set),
 *   - stamp the created Invoice's own soNumber field, since
 *     PurchaseOrder itself has no root-level soNumber (it only lives on
 *     lineItems).
 */
const generateGRNForPO = async ({
  purchaseOrder,
  soNumber,
  lineItems,
  invoiceNo,
  invoiceDate,
  grnDate,
  vehicleNumber,
}) => {


  try {
    lineItems = mergeLineItems(lineItems);

    const grnNumber = await generateGRNNumber();

    let totalGross = 0;
    let totalTaxable = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    let totalNet = 0;

    const invoiceLineItems = [];
    const failedProducts = [];
    const validationErrors = [];
    const productSummary = [];

    const poDistributor = await Distributor.findById(
      purchaseOrder.distributorId
    );

    for (const item of lineItems) {
      const cleanCode = String(item.productCode).trim();

      const currentErrors = [];

      const product = await Product.findOne({
        product_code: cleanCode,
      });

      /**
       * ❌ Product not found
       */
      if (!product) {
        currentErrors.push(`Invalid Product Code: ${cleanCode}`);

        validationErrors.push({
          ...item,
          reason: currentErrors.join(" | "),
        });

        continue;
      }

      /**
       * ❌ Product not mapped in PO — match by product AND soNumber
       */
      const poItem = purchaseOrder.lineItems.find(
        (p) =>
          String(p.product) === String(product._id) &&
          (p.soNumber
            ? normalizeSoNumber(p.soNumber).toLowerCase() ===
            normalizeSoNumber(soNumber).toLowerCase()
            : true)
      );

      if (!poItem) {
        currentErrors.push(`${product.name} not mapped in SO`);

        validationErrors.push({
          ...item,
          reason: currentErrors.join(" | "),
        });

        continue;
      }
      const requestedQty = Number(item.orderQty || 0);

      if (!requestedQty || requestedQty <= 0) {
        currentErrors.push(`Invalid qty for ${product.name}`);
      }

      /**
       * 💰 Price Resolution — the PO's own lineItem (`poItem.price`) is a
       * ref to the EXACT Price doc the PO was raised against. The
       * distributor -> regional -> national fallback below only runs
       * if the PO line item has no price ref at all.
       */
      let priceDoc = poItem.price
        ? await Price.findById(poItem.price)
        : null;

      if (!priceDoc) {
        priceDoc = await Price.findOne({
          productId: product._id,
          distributorId: purchaseOrder.distributorId,
          status: true,
        })
          .sort({ createdAt: -1 });
      }

      if (!priceDoc && poDistributor?.regionId) {
        priceDoc = await Price.findOne({
          productId: product._id,
          price_type: "regional",
          regionId: poDistributor.regionId,
          status: true,
        })
          .sort({ createdAt: -1 });
      }

      if (!priceDoc) {
        priceDoc = await Price.findOne({
          productId: product._id,
          price_type: "national",
          status: true,
        })
          .sort({ createdAt: -1 });
      }

      if (!priceDoc) {
        currentErrors.push(`${product.name} no price found`);
      }

      /**
       * ❌ Validation failed
       */
      if (currentErrors.length > 0) {
        failedProducts.push(currentErrors.join(" | "));

        validationErrors.push({
          ...item,
          reason: currentErrors.join(" | "),
        });

        continue;
      }

      /**
       * 💵 Pricing
       *
       * Gross value is the SO qty priced at the distributor list price
       * (dlp_price on the Price doc). For box-UOM products it's brought
       * down to a per-piece rate first.
       *
       * If a Price doc has no dlp_price configured, fall back to the
       * mrp - L1% calc rather than silently invoicing the line at ₹0.
       */
      const mrp = Number(priceDoc.mrp_price || 0);
      const dlpPrice = Number(priceDoc.dlp_price || 0);

      const piecesPerUnit = Number(product.no_of_pieces_in_a_box || 0);

      let basicRate =
        product.uom === "box" && piecesPerUnit > 0
          ? dlpPrice / piecesPerUnit
          : dlpPrice;

      if (!basicRate) {
        const l1 = Number(poItem.l1Basic ?? 0);
        basicRate = l1 > 0 ? mrp - (mrp * l1) / 100 : mrp;
      }

      /**
       * 🧾 Tax
       */
      let cgstPercent = Number(product?.cgst || 0);
      let sgstPercent = Number(product?.sgst || 0);
      let igstPercent = Number(product?.igst || 0);

      if (!cgstPercent && !sgstPercent && !igstPercent) {
        cgstPercent = 9;
        sgstPercent = 9;
      }

      const grossAmount = basicRate * requestedQty;

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (igstPercent > 0) {
        igst = (grossAmount * igstPercent) / 100;
      } else {
        cgst = (grossAmount * cgstPercent) / 100;
        sgst = (grossAmount * sgstPercent) / 100;
      }

      const netAmount = grossAmount + cgst + sgst + igst;

      /**
       * ➕ Totals
       */
      totalGross += grossAmount;
      totalTaxable += grossAmount;
      totalCGST += cgst;
      totalSGST += sgst;
      totalIGST += igst;
      totalNet += netAmount;

      /**
       * ✅ Invoice Line
       * (productCode / productName are helper-only, stripped before save)
       */
      invoiceLineItems.push({
        product: product._id,
        productCode: cleanCode,
        productName: product.name,
        plant: poItem.plant || null,
        goodsType: "billed",
        mrp,
        basicRate,
        qty: requestedQty,
        receivedQty: requestedQty,
        poNumber: purchaseOrder.purchaseOrderNo,
        grossAmount,
        taxableAmount: grossAmount,
        cgst,
        sgst,
        igst,
        netAmount,
        adjustmentStatus: "success",
      });

      productSummary.push(`${product.name} (${requestedQty})`);
    }

    /**
     * ❌ FULL PO FAIL
     */
    if (validationErrors.length > 0) {
      const fullPoErrors = lineItems.map((item) => {
        const matchedErrors = validationErrors
          .filter(
            (v) =>
              String(v.productCode).trim() ===
              String(item.productCode).trim()
          )
          .map((v) => v.reason);

        return {
          ...item,
          originalRow: item.originalRow,
          reason:
            matchedErrors.length > 0
              ? matchedErrors.join(" | ")
              : "Cancelled because another product in same SO failed",
        };
      });

      throw {
        message: "Full PO cancelled due to validation errors",
        validationErrors: fullPoErrors,
      };
    }

    /**
     * ❌ No valid items
     */
    if (!invoiceLineItems.length) {
      throw {
        message: "No valid quantity",
        validationErrors,
      };
    }

    /**
     * ❌ Duplicate Invoice Validation
     */
    if (invoiceNo) {
      const existingInvoice = await Invoice.findOne({
        invoiceNo: String(invoiceNo).trim(),
      });

      if (existingInvoice) {
        throw {
          message: `Invoice Number ${invoiceNo} already exists`,
          validationErrors: lineItems.map((item) => ({
            ...item,
            originalRow: item.originalRow,
            reason: `Invoice Number ${invoiceNo} already exists`,
          })),
        };
      }
    }

    // =========================
    // 🛑 IN-TRANSIT CHECK (before anything is saved)
    // =========================
    if (!purchaseOrder.godownId) {
      throw {
        message: "Purchase Order has no Godown assigned. Cannot proceed with GRN.",
        validationErrors: lineItems.map((item) => ({
          ...item,
          originalRow: item.originalRow,
          reason: "Purchase Order has no Godown assigned",
        })),
      };
    }

    const grnEntries = invoiceLineItems.map((li) => ({
      name: li.productName,
      productCode: li.productCode,
      qty: Number(li.receivedQty || li.qty || 0),
      filter: {
        distributorId: purchaseOrder.distributorId,
        productId: li.product,
        godownId: purchaseOrder.godownId,
      },
    }));

    const intransitErrors = await validateIntransit(grnEntries);

    if (intransitErrors.length > 0) {
      throw {
        message: `GRN failed. ${intransitErrors
          .map((e) => e.reason)
          .join(" | ")}`,
        validationErrors: lineItems.map((item) => {
          const matched = intransitErrors
            .filter(
              (e) =>
                String(e.productCode).trim() ===
                String(item.productCode).trim()
            )
            .map((e) => e.reason);

          return {
            ...item,
            originalRow: item.originalRow,
            reason:
              matched.length > 0
                ? matched.join(" | ")
                : "Cancelled because another product in same SO failed",
          };
        }),
      };
    }

    // =========================
    // 🏷️ DETERMINE INVOICE TYPE
    // =========================
    const relevantPoItems = purchaseOrder.lineItems.filter(
      (p) =>
        p.soNumber
          ? normalizeSoNumber(p.soNumber).toLowerCase() ===
          normalizeSoNumber(soNumber).toLowerCase()
          : true
    );

    const isSingleInvoiceComplete = relevantPoItems.every(
      (poItem) => {
        const currentReceived = invoiceLineItems
          .filter(
            (li) => String(li.product) === String(poItem.product)
          )
          .reduce((sum, li) => sum + (li.qty || 0), 0);

        // orderQty is already stored pcs-level (see bulk/single PO
        // controllers).
        const poQtyInPcs = Number(poItem.orderQty || 0);

        return currentReceived >= poQtyInPcs;
      }
    );

    const invoicetype = isSingleInvoiceComplete
      ? "Complete-Invoiced"
      : "Partially-Invoiced";

    // =========================
    // 🔢 ROUND OFF
    // =========================
    const roundedInvoiceAmount = Math.round(totalNet);
    const roundOff = roundedInvoiceAmount - totalNet;

    // strip helper-only fields before saving
    const invoiceLineItemsToSave = invoiceLineItems.map(
      ({ productCode, productName, ...rest }) => rest
    );

    // =========================
    // 📉 RESERVE IN-TRANSIT (atomic, never goes below 0)
    // =========================
    const reserve = await deductAllOrRollback(grnEntries);

    if (!reserve.ok) {
      // Another request used the stock between our check and now.
      throw {
        message: `GRN failed. ${reserve.message}`,
        validationErrors: lineItems.map((item) => ({
          ...item,
          originalRow: item.originalRow,
          reason: reserve.message,
        })),
      };
    }

    /**
     * 🧾 Create Invoice
     * If this fails for any reason, the reserved in-transit is put back.
     */
    let invoice;

    try {
      [invoice] = await Invoice.create(
        [
          {
            distributorId: purchaseOrder.distributorId,

            godownId: purchaseOrder.godownId,

            invoiceNo:
              invoiceNo ||
              (await generateInvoiceNumber()),

            date: invoiceDate
              ? moment(invoiceDate, "DD-MM-YYYY")
                .format("YYYY-MM-DD")
              : new Date(),

            invoiceDate: invoiceDate
              ? moment(invoiceDate, "DD-MM-YYYY")
                .format("YYYY-MM-DD")
              : null,

            grnDate: grnDate
              ? moment(grnDate, "DD-MM-YYYY")
                .format("YYYY-MM-DD")
              : new Date(),

            vehicleNumber: vehicleNumber || "",

            grnNumber,

            purchaseOrderId: purchaseOrder._id,

            soNumber: soNumber || "",

            lineItems: invoiceLineItemsToSave,

            grossAmount: totalGross,

            taxableAmount: totalTaxable,

            cgst: totalCGST,

            sgst: totalSGST,

            igst: totalIGST,

            invoiceAmount: totalNet,

            roundOff,

            totalInvoiceAmount: roundedInvoiceAmount,

            GRNLogId: new mongoose.Types.ObjectId(),

            GRNFKDATE: new Date(),

            grnStatus: "success",

            invoicetype,

            adjustmentSummary: {
              totalProducts: invoiceLineItems.length,
              successfulAdjustments: invoiceLineItems.length,
              failedAdjustments: failedProducts.length,
              lastRetryAttempt: new Date(),
            },
          },
        ],
      );
    } catch (createErr) {
      await rollbackAll(grnEntries);
      throw createErr;
    }

    /**
     * 🔥 STOCK UPDATE + TRANSACTION + LEDGER
     * 🔥 REWARD POINTS
     * 🔥 TARGET ACHIEVEMENT
     *
     * godownId comes from the PO itself — stock always lands in the same
     * godown the purchase order was raised against.
     */
    const { stockSummary, stockAdjustmentErrors } =
      await processInvoiceAdjustments({
        invoice,
        godownId: purchaseOrder.godownId,
      });

    /**
     * 🔗 Update PO invoice ids
     */
    await PurchaseOrder.findByIdAndUpdate(
      purchaseOrder._id,
      {
        $addToSet: { invoiceIds: invoice._id },
      },
    );

    /**
     * 🔄 Update PO Invoice Status (whole-PO status, aggregated across
     * EVERY invoice ever created against this PO).
     */
    const allInvoices = await Invoice.find({
      purchaseOrderId: purchaseOrder._id,
    });

    const totalReceivedMap = {};

    for (const inv of allInvoices) {
      for (const li of inv.lineItems) {
        const key = String(li.product);

        totalReceivedMap[key] =
          (totalReceivedMap[key] || 0) +
          Number(li.receivedQty || li.qty || 0);
      }
    }

    let isComplete = true;
    let isPartial = false;

    for (const poItem of purchaseOrder.lineItems) {
      const received =
        totalReceivedMap[String(poItem.product)] || 0;

      const poQtyInPcs = Number(poItem.orderQty || 0);

      if (received === 0) {
        isComplete = false;
      } else if (received < poQtyInPcs) {
        isComplete = false;
        isPartial = true;
      } else {
        isPartial = true;
      }
    }

    let status = "Pending";

    if (isComplete) {
      status = "Complete-Invoiced";
    } else if (isPartial) {
      status = "Partially-Invoiced";
    }

    await PurchaseOrder.findByIdAndUpdate(
      purchaseOrder._id,
      {
        $set: { invoicestatus: status },
      },
    );



    return {
      message: `GRN created: ${productSummary.join(", ")}${failedProducts.length
        ? ` | Failed: ${failedProducts.join(", ")}`
        : ""
        }${stockAdjustmentErrors.length
          ? ` | Stock not updated for: ${stockAdjustmentErrors
            .map((e) => e.error)
            .join(", ")}`
          : ""
        }`,
      data: invoice,
      stockSummary,
      stockAdjustmentErrors,
    };
  } catch (error) {

    throw {
      message: error.message || "GRN creation failed",
      validationErrors: error.validationErrors || [],
    };
  }
};

/**
 * 🚀 BULK IMPORT API
 */
const importGrnforPoOrder = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;

    console.log("Received rows:", rows);
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No data provided" });
    }

    /**
     * 📦 Group by SO Number, then by Invoice Number.
     *
     * `grouped[soNumber][invoiceKey]` holds the rows for one GRN/Invoice.
     * A single SO can be split across several distinct Invoice Numbers —
     * each subgroup is confirmed as its own GRN. Rows without an Invoice
     * Number fall into ONE shared AUTO_INVOICE_KEY bucket per SO.
     */
    const grouped = {};

    for (const row of rows) {
      const soNumber = normalizeSoNumber(
        row["SO Number"] || row["soNumber"]
      );

      const productCode =
        row["Product Code"] || row["productCode"];

      if (!soNumber || !productCode) {
        continue;
      }

      const invoiceNoRaw =
        row["Invoice Number"] ||
        row["invoiceNo"] ||
        row["invoice_number"] ||
        null;

      const invoiceKey = invoiceNoRaw
        ? String(invoiceNoRaw).trim()
        : AUTO_INVOICE_KEY;

      if (!grouped[soNumber]) {
        grouped[soNumber] = {};
      }

      if (!grouped[soNumber][invoiceKey]) {
        grouped[soNumber][invoiceKey] = [];
      }

      const product = await Product.findOne({
        product_code: String(productCode).trim(),
      });

      if (!product) {
        grouped[soNumber][invoiceKey].push({
          productCode: String(productCode).trim(),
          orderQty: 0,
          invoiceNo: invoiceNoRaw,
          originalRow: row,
        });

        continue;
      }

      /**
       * 📦 Qty resolution — GRN Qty (PCS) vs GRN Qty (UOM)
       *
       * If GRN Qty (PCS) is present on the row, it's already piece-level
       * and is used as-is. Only when PCS isn't supplied do we fall back
       * to GRN Qty (UOM) * pieces-per-box for any uom other than "pcs".
       * The final qty is always in PIECES, which is the same unit
       * intransitQty is kept in.
       */
      const uomQtyRaw = row["GRN Qty (UOM)"];
      const pcsQtyRaw = row["GRN Qty (PCS)"];

      const pcsPerBox = Number(
        product.no_of_pieces_in_a_box || 0
      );

      let finalQty = 0;

      if (
        pcsQtyRaw !== undefined &&
        pcsQtyRaw !== null &&
        String(pcsQtyRaw).trim() !== ""
      ) {
        finalQty = Number(pcsQtyRaw || 0);
      } else {
        const boxOrderQty = Number(uomQtyRaw || 0);

        finalQty =
          product.uom !== "pcs" && pcsPerBox > 0
            ? boxOrderQty * pcsPerBox
            : boxOrderQty;
      }

      grouped[soNumber][invoiceKey].push({
        productCode: String(productCode).trim(),

        orderQty: finalQty,

        invoiceNo: invoiceNoRaw,

        invoiceDate:
          row["Invoice Date"] || null,

        grnDate:
          row["GRN Date"] || null,

        vehicleNumber:
          row["Vehicle Number"] || "",

        originalRow: row,
      });


    }

    const results = [];
    const errors = [];
    const errorCsvRows = [];

    /**
     * 🚀 Process Each SO, and within it each distinct Invoice Number
     * subgroup as its own GRN/Invoice.
     */
    for (const soNumber of Object.keys(grouped)) {
      const purchaseOrder = await PurchaseOrder.findOne({
        "lineItems.soNumber": new RegExp(
          `^${escapeRegex(soNumber)}$`,
          "i"
        ),
      });

      if (!purchaseOrder) {
        const message = `SO Number "${soNumber}" not found`;

        for (const invoiceKey of Object.keys(grouped[soNumber])) {
          errors.push({
            soNumber,
            invoiceNo:
              invoiceKey === AUTO_INVOICE_KEY ? null : invoiceKey,
            message,
          });

          grouped[soNumber][invoiceKey].forEach((item) => {
            errorCsvRows.push({
              ...item.originalRow,
              Reason: message,
            });
          });
        }

        continue;
      }

      for (const invoiceKey of Object.keys(grouped[soNumber])) {
        const items = grouped[soNumber][invoiceKey];

        try {
          const result = await generateGRNForPO({
            purchaseOrder,

            soNumber,

            lineItems: items,

            invoiceNo: items[0]?.invoiceNo || null,

            invoiceDate: items[0]?.invoiceDate || null,

            grnDate: items[0]?.grnDate || null,

            vehicleNumber: items[0]?.vehicleNumber || "",
          });

          results.push({
            soNumber,
            invoiceNo: result.data?.invoiceNo || null,
            purchaseOrderNo: purchaseOrder.purchaseOrderNo,
            message: result.message,
            stockSummary: result.stockSummary,
            stockAdjustmentErrors: result.stockAdjustmentErrors,
          });
        } catch (err) {
          errors.push({
            soNumber,
            invoiceNo:
              invoiceKey === AUTO_INVOICE_KEY ? null : invoiceKey,
            message: err.message,
          });

          /**
           * ✅ Validation Error CSV
           */
          if (
            err.validationErrors &&
            Array.isArray(err.validationErrors) &&
            err.validationErrors.length > 0
          ) {
            err.validationErrors.forEach((item) => {
              errorCsvRows.push({
                ...item.originalRow,
                Reason:
                  item.reason || err.message || "Validation failed",
              });
            });
          }

          /**
           * ✅ ANY OTHER ERROR CSV
           */
          else {
            items.forEach((item) => {
              errorCsvRows.push({
                ...item.originalRow,
                Reason: err.message || "Unknown error",
              });
            });
          }
        }
      }
    }

    return res.status(200).json({
      message: "Bulk GRN processed",
      successCount: results.length,
      failedCount: errors.length,
      results,
      errors,
      errorCsv: errorCsvRows.length > 0 ? errorCsvRows : [],
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = {
  importGrnforPoOrder,
};