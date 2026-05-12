const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const Price = require("../../models/price.model");
const Product = require("../../models/product.model");

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
const generateGRNNumber = async (session) => {
  const year = new Date().getFullYear().toString().slice(-2);

  const lastInvoice = await Invoice.findOne({
    grnNumber: { $regex: `^GRN-${year}` },
  })
    .sort({ createdAt: -1 })
    .session(session);

  let nextSequence = 1;

  if (lastInvoice?.grnNumber) {
    const lastNumber = lastInvoice.grnNumber.split("-")[1];
    const lastSeq = Number(lastNumber.slice(2));
    nextSequence = lastSeq + 1;
  }

  return `GRN-${year}${String(nextSequence).padStart(5, "0")}`;
};

/**
 * 🔥 CORE GRN GENERATOR
 */
const generateInvoiceNumber = async (session) => {
  const year = new Date().getFullYear().toString().slice(-2);

  const lastInvoice = await Invoice.findOne({
    invoiceNo: { $regex: `^INV-${year}` },
  })
    .sort({ createdAt: -1 })
    .session(session);

  let nextSequence = 1;

  if (lastInvoice?.invoiceNo) {
    const lastNumber =
      lastInvoice.invoiceNo.split("-")[1];

    const lastSeq = Number(lastNumber.slice(2));

    nextSequence = lastSeq + 1;
  }

  return `INV-${year}${String(nextSequence).padStart(
    5,
    "0"
  )}`;
};

const generateGRNForPO = async ({
  purchaseOrder,
  lineItems,
  invoiceNo,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    lineItems = mergeLineItems(lineItems);

    // 📦 Existing invoices
    const invoices = await Invoice.find({
      purchaseOrderId: purchaseOrder._id,
    }).session(session);

    const receivedMap = {};

    for (const inv of invoices) {
      for (const li of inv.lineItems) {
        const key = String(li.product);

        receivedMap[key] =
          (receivedMap[key] || 0) +
          Number(li.receivedQty || li.qty || 0);
      }
    }

    const grnNumber = await generateGRNNumber(session);

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










    for (const item of lineItems) {
      const cleanCode = String(
        item.productCode
      ).trim();

      const currentErrors = [];

      const product = await Product.findOne({
        product_code: cleanCode,
      }).session(session);

      // ❌ Product not found
      if (!product) {
        currentErrors.push(
          `Invalid Product Code: ${cleanCode}`
        );

        validationErrors.push({
          ...item,
          reason: currentErrors.join(" | "),
        });

        continue;
      }

      const poItem = purchaseOrder.lineItems.find(
        (p) =>
          String(p.product) ===
          String(product._id)
      );

      // ❌ Product not in PO
      if (!poItem) {
        currentErrors.push(
          `${product.name} not mapped in SO`
        );

        validationErrors.push({
          ...item,
          reason: currentErrors.join(" | "),
        });

        continue;
      }

      const requestedQty = Number(
        item.orderQty || 0
      );

      const alreadyReceived =
        receivedMap[String(product._id)] || 0;

      const remainingQty =
        poItem.orderQty - alreadyReceived;

      // ❌ qty validations
      if (
        remainingQty <= 0 &&
        requestedQty > 0
      ) {
        currentErrors.push(
          `${product.name} no qty left`
        );
      }

      if (requestedQty > remainingQty) {
        currentErrors.push(
          `Only ${remainingQty} qty left for ${product.name}`
        );
      }

      if (
        !requestedQty ||
        requestedQty <= 0
      ) {
        currentErrors.push(
          `Invalid qty for ${product.name}`
        );
      }

      // 💰 price
      let priceDoc = await Price.findOne({
        productId: product._id,
        distributorId:
          purchaseOrder.distributorId,
        status: true,
      })
        .sort({ createdAt: -1 })
        .session(session);

      if (!priceDoc) {
        priceDoc = await Price.findOne({
          productId: product._id,
          price_type: "national",
          status: true,
        })
          .sort({ createdAt: -1 })
          .session(session);
      }

      if (!priceDoc) {
        currentErrors.push(
          `${product.name} no price found`
        );
      }

      // ❌ if any validation failed
      if (currentErrors.length > 0) {
        failedProducts.push(
          currentErrors.join(" | ")
        );

        validationErrors.push({
          ...item,
          reason: currentErrors.join(" | "),
        });

        continue;
      }

      const mrp = Number(
        priceDoc.mrp_price || 0
      );

      const l1 = Number(
        item.l1Basic ??
        poItem.l1Basic ??
        0
      );

      let basicRate = mrp;

      if (l1 > 0) {
        basicRate =
          mrp - (mrp * l1) / 100;
      }

      // 🧾 tax
      let cgstPercent = Number(
        product?.cgst || 0
      );

      let sgstPercent = Number(
        product?.sgst || 0
      );

      let igstPercent = Number(
        product?.igst || 0
      );

      if (
        !cgstPercent &&
        !sgstPercent &&
        !igstPercent
      ) {
        cgstPercent = 9;
        sgstPercent = 9;
      }

      const grossAmount =
        basicRate * requestedQty;

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (igstPercent > 0) {
        igst =
          (grossAmount * igstPercent) /
          100;
      } else {
        cgst =
          (grossAmount * cgstPercent) /
          100;

        sgst =
          (grossAmount * sgstPercent) /
          100;
      }

      const netAmount =
        grossAmount +
        cgst +
        sgst +
        igst;

      // ➕ totals
      totalGross += grossAmount;
      totalTaxable += grossAmount;
      totalCGST += cgst;
      totalSGST += sgst;
      totalIGST += igst;
      totalNet += netAmount;

      invoiceLineItems.push({
        product: product._id,
        plant: poItem.plant || null,
        goodsType: "billed",
        mrp,
        basicRate,
        qty: requestedQty,
        receivedQty: requestedQty,
        poNumber:
          purchaseOrder.purchaseOrderNo,
        grossAmount,
        taxableAmount: grossAmount,
        cgst,
        sgst,
        igst,
        netAmount,
        adjustmentStatus: "success",
      });

      productSummary.push(
        `${product.name} (${requestedQty})`
      );
    }



    // If ANY error exists then FULL PO cancel
    if (validationErrors.length > 0) {
      const fullPoErrors = lineItems.map((item) => {

        // find matching validation errors
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
        message:
          "Full PO cancelled due to validation errors",

        validationErrors: fullPoErrors,
      };
    }

    // ❌ no valid items
    if (!invoiceLineItems.length) {
      throw {
        message: "No valid quantity",
        validationErrors,
      };
    }

    // 🧾 create invoice
    const [invoice] = await Invoice.create(
      [
        {
          distributorId: purchaseOrder.distributorId,
          invoiceNo:
            invoiceNo ||
            (await generateInvoiceNumber(session)),
          date: new Date(),
          status: "Confirmed",
          grnDate: new Date(),
          grnNumber,
          purchaseOrderId: purchaseOrder._id,
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
          adjustmentSummary: {
            totalProducts: invoiceLineItems.length,
            successfulAdjustments:
              invoiceLineItems.length,
            failedAdjustments:
              failedProducts.length,
            lastRetryAttempt: new Date(),
          },
        },
      ],
      { session }
    );

    await PurchaseOrder.findByIdAndUpdate(
      purchaseOrder._id,
      {
        $addToSet: {
          invoiceIds: invoice._id,
        },
      },
      { session }
    );

    // 🔄 update PO status
    const allInvoices = await Invoice.find({
      purchaseOrderId: purchaseOrder._id,
    }).session(session);

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

      if (received === 0) {
        isComplete = false;
      } else if (received < poItem.orderQty) {
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
        $set: {
          invoicestatus: status,
        },
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return {
      message: `GRN created: ${productSummary.join(", ")}${failedProducts.length
        ? ` | Failed: ${failedProducts.join(", ")}`
        : ""
        }`,
      data: invoice,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    throw {
      message:
        error.message ||
        "GRN creation failed",

      validationErrors:
        error.validationErrors || [],
    };
  }
};

/**
 * 🚀 BULK API
 */
const importGrnforPoOrder = asyncHandler(
  async (req, res) => {
    try {
      const rows = req.body.data;
      console.log("Received rows:", rows);

      if (
        !rows ||
        !Array.isArray(rows) ||
        rows.length === 0
      ) {
        return res.status(400).json({
          message: "No data provided",
        });
      }

      const grouped = {};

      for (const row of rows) {
        const soNumber =
          row["SO Number"] ||
          row["soNumber"];

        const productCode =
          row["Product Code"] ||
          row["productCode"];

        if (!soNumber || !productCode) {
          continue;
        }

        if (!grouped[soNumber]) {
          grouped[soNumber] = [];
        }

        // ✅ ONLY CHANGE: SO Qty correction
        const product = await Product.findOne({
          product_code: String(productCode).trim(),
        });

        if (!product) {
          continue;
        }

        const boxOrderQty = Number(
          row["Order Qty (UOM)"] || 0
        );

        const pcsPerBox = Number(
          product.no_of_pieces_in_a_box || 0
        );

        // ✅ Final PCS Qty
        const finalQty =
          boxOrderQty * pcsPerBox;

        grouped[soNumber].push({
          productCode: String(productCode).trim(),

          orderQty: finalQty,

          l1Basic: Number(
            row["L1 Basic"] ||
            row["l1Basic"] ||
            0
          ),

          invoiceNo:
            row["Invoice Number"] ||
            row["invoiceNo"] ||
            row["invoice_number"] ||
            null,

          originalRow: row,
        });
      }

      const results = [];
      const errors = [];
      const errorCsvRows = [];

      for (const soNumber of Object.keys(grouped)) {
        try {
          const purchaseOrder =
            await PurchaseOrder.findOne({
              soNumber: soNumber,
            });

          if (!purchaseOrder) {
            throw new Error(
              "SO Number not found"
            );
          }

          const result =
            await generateGRNForPO({
              purchaseOrder,
              lineItems: grouped[soNumber],

              invoiceNo:
                grouped[soNumber][0]?.invoiceNo || null,
            });

          results.push({
            soNumber,
            purchaseOrderNo:
              purchaseOrder.purchaseOrderNo,
            message: result.message,
          });
        } catch (err) {
          errors.push({
            soNumber,
            message: err.message,
          });

          // ✅ error csv rows
          if (
            err.validationErrors &&
            Array.isArray(
              err.validationErrors
            )
          ) {
            err.validationErrors.forEach(
              (item) => {
                errorCsvRows.push({
                  ...item.originalRow,

                  Reason: item.reason,
                });
              }
            );
          }
        }
      }

      return res.status(200).json({
        message: "Bulk GRN processed",

        successCount: results.length,

        failedCount: errors.length,

        results,

        errors,

        errorCsv:
          errorCsvRows.length > 0
            ? errorCsvRows
            : [],
      });
    } catch (error) {
      return res.status(500).json({
        message:
          error.message ||
          "Something went wrong",
      });
    }
  }
);

module.exports = {
  importGrnforPoOrder,
};