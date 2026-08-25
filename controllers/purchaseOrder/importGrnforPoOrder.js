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
 */
const processInvoiceAdjustments = async ({
  invoice,
  godownId,
}) => {

  const distributorId = invoice.distributorId;

  // Fetched once up front — used both for price resolution (regional
  // price is scoped by the distributor's regionId, not by distributorId
  // itself) and later for the reward-points section, so we don't hit
  // the DB twice for the same document.
  const distributor = await Distributor.findById(distributorId);

  const stockId = await transactionCode("LXSTA");

  // One item's failure (e.g. a missing Price doc) must not stop the loop
  // for every OTHER item in this same invoice — previously a bare `throw`
  // inside this loop propagated straight out of processInvoiceAdjustments
  // and silently left every later item's Inventory (totalStockamtDlp,
  // totalStockamtRlp, intransitQty) completely untouched, even though the
  // Invoice itself had already been created and looked successful.
  const stockSummary = [];
  const stockAdjustmentErrors = [];

  for (const item of invoice.lineItems) {

    if (item.receivedQty <= 0) {
      continue;
    }

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
     *
     * A price doc with price_type "regional" always has
     * distributorId: null (it's shared by every distributor in that
     * region), so it will never match a `{ distributorId }` query.
     * Skipping the regional tier meant any product priced only at the
     * regional level (no distributor override, no national price)
     * either threw "Price not found" here — silently skipping its
     * Inventory update entirely — or, worse, could pick up an unrelated
     * Price doc with blank dlp_price/rlp_price, resolving the rate to 0
     * without erroring. Either way totalStockamtDlp/totalStockamtRlp
     * came out 0 even while availableQty moved normally.
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
     *
     * The old `+=` accumulator approach meant that if ANY earlier
     * receipt resolved dlpbyPcs/rlpbyPcs to 0 (e.g. a Price doc whose
     * dlp_price/rlp_price is null — only mrp_price is required on the
     * Price schema), that receipt's contribution was permanently baked
     * in as 0 and never corrected, and the total also drifted out of
     * sync whenever the price changed between GRNs for the same
     * product/distributor. Recomputing from the current availableQty
     * and current price keeps the figure always correct and self-heals
     * a previously-zeroed total the next time stock moves.
     */
    inventory.totalStockamtDlp =
      inventory.availableQty * dlpbyPcs;

    inventory.totalStockamtRlp =
      inventory.availableQty * rlpbyPcs;

    // Received stock also clears out of "in transit" once it lands.
    inventory.intransitQty = Math.max(
      0,
      Number(inventory.intransitQty || 0) - Number(item.receivedQty || 0)
    );

    await inventory.save();

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
      // Don't let one product's failure (missing Price, missing Product,
      // etc.) silently skip every item after it — record which product
      // failed and why, and move on to the next line item.
      console.error(
        `Stock adjustment failed for product ${item.product} on invoice ${invoice.invoiceNo}:`,
        itemError.message
      );

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

  // `distributor` was already fetched at the top of this function for
  // price resolution — reused here rather than querying it again.
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

    // Fetched once, used for the same distributor -> regional -> national
    // price fallback as processInvoiceAdjustments below — a "regional"
    // Price doc is scoped by regionId with distributorId: null, so it
    // only ever matches via the distributor's OWN regionId, never via a
    // `{ distributorId }` query.
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
       * (both normalized) when the PO line item carries one, so a PO
       * spanning multiple SOs doesn't cross-credit the wrong SO's line
       * item, and so trivial whitespace/case differences don't cause a
       * false "not mapped in SO" mismatch either.
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
       * 💰 Price Validation — same distributor -> regional -> national
       * fallback used in processInvoiceAdjustments (see comment there).
       */
      let priceDoc = await Price.findOne({
        productId: product._id,
        distributorId: purchaseOrder.distributorId,
        status: true,
      })
        .sort({ createdAt: -1 });

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
       */
      const mrp = Number(priceDoc.mrp_price || 0);

      const l1 = Number(item.l1Basic ?? poItem.l1Basic ?? 0);

      let basicRate = mrp;

      if (l1 > 0) {
        basicRate = mrp - (mrp * l1) / 100;
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
       */
      invoiceLineItems.push({
        product: product._id,
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
    // 🏷️ DETERMINE INVOICE TYPE
    // =========================
    // Scoped to just THIS soNumber's line items — a PO that happens to
    // mix multiple SOs shouldn't have one SO's completeness decided by
    // another SO's unrelated items.
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
        // controllers), so it's used directly rather than recomputed
        // from boxOrderQty * pcsPerBox — that recompute silently gave 0
        // for products ordered in "pcs" uom, since boxOrderQty is 0 then.
        const poQtyInPcs = Number(poItem.orderQty || 0);

        return currentReceived >= poQtyInPcs;
      }
    );

    const invoicetype = isSingleInvoiceComplete
      ? "Complete-Invoiced"
      : "Partially-Invoiced";

    /**
     * 🧾 Create Invoice
     */
    const [invoice] = await Invoice.create(
      [
        {
          distributorId: purchaseOrder.distributorId,

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
          // PurchaseOrder has no root-level soNumber field (it lives on
          // lineItems) — stamp the actual (normalized) SO key this GRN
          // batch is for.
          soNumber: normalizeSoNumber(soNumber),

          lineItems: invoiceLineItems,

          grossAmount: totalGross,

          taxableAmount: totalTaxable,

          cgst: totalCGST,

          sgst: totalSGST,

          igst: totalIGST,

          invoiceAmount: totalNet,

          totalInvoiceAmount: totalNet,

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
     * 🔄 Update PO Invoice Status (whole-PO status, across all of its
     * line items regardless of soNumber — invoicestatus is a PO-root
     * field, not per-SO).
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

      // orderQty is already the pcs-level PO quantity.
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
      // Per-product available/in-transit qty + running total DLP/RLP
      // stock value for every item that DID get its stock adjusted.
      stockSummary,
      // Items whose stock adjustment failed (e.g. missing Price doc) —
      // the invoice line item itself still exists, but its Inventory
      // (totalStockamtDlp/totalStockamtRlp/intransitQty) was NOT touched.
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

    const grouped = {};

    /**
     * 📦 Group by SO Number (normalized: trimmed, so a CSV with stray
     * whitespace around "SO000001" still groups into the same batch as
     * the one used when the purchase order was created).
     */
    for (const row of rows) {
      const soNumber = normalizeSoNumber(
        row["SO Number"] || row["soNumber"]
      );

      const productCode =
        row["Product Code"] || row["productCode"];

      if (!soNumber || !productCode) {
        continue;
      }

      if (!grouped[soNumber]) {
        grouped[soNumber] = [];
      }

      const product = await Product.findOne({
        product_code: String(productCode).trim(),
      });

      if (!product) {
        grouped[soNumber].push({
          productCode: String(productCode).trim(),
          orderQty: 0,
          invoiceNo: row["Invoice Number"] || null,
          originalRow: row,
        });

        continue;
      }

      const boxOrderQty = Number(row["GRN Qty (UOM)"] || 0);

      const pcsPerBox = Number(
        product.no_of_pieces_in_a_box || 0
      );

      // Only rescale by pieces-per-box for box-style UOMs — for products
      // ordered in plain "pcs", the qty column is already pcs-level, and
      // multiplying by a 0/undefined pcsPerBox would silently zero it out.
      const finalQty =
        product.uom !== "pcs" && pcsPerBox > 0
          ? boxOrderQty * pcsPerBox
          : boxOrderQty;

      grouped[soNumber].push({
        productCode: String(productCode).trim(),

        orderQty: finalQty,

        l1Basic: Number(
          row["L1 Basic"] || row["l1Basic"] || 0
        ),

        invoiceNo:
          row["Invoice Number"] ||
          row["invoiceNo"] ||
          row["invoice_number"] ||
          null,

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
     * 🚀 Process Each SO
     */
    for (const soNumber of Object.keys(grouped)) {
      try {
        /**
         * ❌ Same SO must have same invoice number
         */
        const invoiceNumbers = [
          ...new Set(
            grouped[soNumber]
              .map((item) => String(item.invoiceNo || "").trim())
              .filter(Boolean)
          ),
        ];

        if (invoiceNumbers.length > 1) {
          throw {
            message:
              "Multiple invoice numbers found for same SO",
            validationErrors: grouped[soNumber].map((item) => ({
              ...item,
              originalRow: item.originalRow,
              reason:
                "All products of same SO must have same Invoice Number",
            })),
          };
        }

        // soNumber lives on lineItems, not on the PurchaseOrder root —
        // find the PO that actually has a line item carrying this SO.
        // Case-insensitive + already-trimmed `soNumber` guards against
        // the exact same value being typed with different casing across
        // the bulk-PO-create sheet and this GRN sheet.
        const purchaseOrder = await PurchaseOrder.findOne({
          "lineItems.soNumber": new RegExp(
            `^${escapeRegex(soNumber)}$`,
            "i"
          ),
        });

        if (!purchaseOrder) {
          throw new Error(`SO Number "${soNumber}" not found`);
        }

        const result = await generateGRNForPO({
          purchaseOrder,

          soNumber,

          lineItems: grouped[soNumber],

          invoiceNo:
            grouped[soNumber][0]?.invoiceNo || null,

          invoiceDate:
            grouped[soNumber][0]?.invoiceDate || null,

          grnDate:
            grouped[soNumber][0]?.grnDate || null,

          vehicleNumber:
            grouped[soNumber][0]?.vehicleNumber || "",
        });

        results.push({
          soNumber,
          purchaseOrderNo: purchaseOrder.purchaseOrderNo,
          message: result.message,
          // Per-product available/in-transit qty + running total DLP/RLP
          // stock value — same figures a single-GRN confirm tracks.
          stockSummary: result.stockSummary,
          // Which products (if any) failed their stock adjustment and why
          // — this is what to check when a product's DLP/RLP total looks
          // stale after a bulk GRN upload.
          stockAdjustmentErrors: result.stockAdjustmentErrors,
        });
      } catch (err) {
        errors.push({
          soNumber,
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
          grouped[soNumber].forEach((item) => {
            errorCsvRows.push({
              ...item.originalRow,
              Reason: err.message || "Unknown error",
            });
          });
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