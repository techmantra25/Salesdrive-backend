const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const Distributor = require("../../models/distributor.model");
const Employee = require("../../models/employee.model");
const OutletApproved = require("../../models/outletApproved.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { enquiryNumberGenerator } = require("../../utils/codeGenerator");

/* ---------------------------------------------------------- helpers --- */

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const safeOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeOptionalPositiveNumber = (value) => {
  const number = safeOptionalNumber(value);
  return number && number > 0 ? number : null;
};

const toTwoDecimal = (value) => Number(safeNumber(value).toFixed(2));
const DEFAULT_ORDER_TYPE = "Normal-Sale";
const DEFAULT_PAYMENT_MODE = "Cash";

const getFirstValue = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
};

const isBlankRow = (row) =>
  Object.values(row || {}).every(
    (value) =>
      value === undefined || value === null || String(value).trim() === "",
  );

const getStateIdentity = (state) => {
  if (!state) return "";
  if (typeof state === "object") {
    return String(state.code || state.slug || state._id || state).trim();
  }
  return String(state).trim();
};

const getIsIgst = ({ distributor, retailer }) => {
  const distributorState = getStateIdentity(distributor?.stateId);
  const retailerState = getStateIdentity(retailer?.stateId);
  return (
    distributorState && retailerState && distributorState !== retailerState
  );
};

const parseOrderDate = (value) => {
  if (!value) return new Date();

  const parsed = moment(
    String(value).trim(),
    [
      "YYYY-MM-DD",
      "DD-MM-YYYY",
      "DD/MM/YYYY",
      "D-M-YYYY",
      "D/M/YYYY",
      "MM/DD/YYYY",
      "M/D/YYYY",
      moment.ISO_8601,
    ],
    true
  );

  if (!parsed.isValid()) return null;

  // Keep the current time
  const now = moment();

  parsed
    .hour(now.hour())
    .minute(now.minute())
    .second(now.second())
    .millisecond(now.millisecond());

  return parsed.toDate();
};

/**
 * Range check: effective_date <= compareDate <= expiresAt (or no expiresAt).
 * When `compareDate` is omitted, falls back to "now" (Asia/Kolkata).
 */
const isPriceValid = (price, compareDate = null) => {
  const cmpDateTime = compareDate
    ? moment(compareDate).tz("Asia/Kolkata").startOf("day").toDate()
    : moment().tz("Asia/Kolkata").toDate();

  const effectiveDate = moment(price?.effective_date)
    .tz("Asia/Kolkata")
    .startOf("day")
    .toDate();

  if (price?.expiresAt) {
    const expiresAt = moment(price?.expiresAt)
      .tz("Asia/Kolkata")
      .endOf("day")
      .toDate();

    return (
      moment(effectiveDate).isSameOrBefore(cmpDateTime) &&
      moment(expiresAt).isSameOrAfter(cmpDateTime)
    );
  }

  return moment(effectiveDate).isSameOrBefore(cmpDateTime);
};

/**
 * Distributor > Regional > National price resolution.
 *
 * If `quotationDate` is supplied (i.e. we're pricing a back/forward-dated
 * enquiry from the CSV's Enquiry Date column), we:
 *   - do NOT filter by `status: true` — an inactive price is still usable
 *     as long as its effective_date/expiresAt window covers quotationDate.
 *   - check date-validity against quotationDate instead of "now".
 *
 * If `quotationDate` is not supplied, behavior is unchanged: only active
 * prices are considered, checked against "now".
 */
const getPriceForProduct = async ({
  productId,
  distributorId,
  regionId,
  quotationDate = null,
}) => {
  const priceQuery = { productId };

  // Only restrict to active prices when NOT doing a quotationDate lookup
  if (!quotationDate) {
    priceQuery.status = true;
  }

  const allPrices = await Price.find(priceQuery).sort({ _id: -1 }).lean();

  const distributorIdStr = distributorId?.toString();
  const regionIdStr = regionId?.toString();

  // Level 1 — Distributor-specific price
  if (distributorIdStr && regionIdStr) {
    const distributorPrice = allPrices.find(
      (p) =>
        p.price_type === "distributor" &&
        p.distributorId?.toString() === distributorIdStr &&
        p.regionId?.toString() === regionIdStr &&
        isPriceValid(p, quotationDate),
    );
    if (distributorPrice) return distributorPrice;
  }

  // Level 2 — Regional price
  if (regionIdStr) {
    const regionalPrice = allPrices.find(
      (p) =>
        p.price_type === "regional" &&
        p.regionId?.toString() === regionIdStr &&
        isPriceValid(p, quotationDate),
    );
    if (regionalPrice) return regionalPrice;
  }

  // Level 3 — National fallback
  const nationalPrice = allPrices.find(
    (p) => p.price_type === "national" && isPriceValid(p, quotationDate),
  );

  return nationalPrice || null;
};

const getApplicableTaxRate = ({ product, taxableAmt, qty }) => {
  let cgst = safeNumber(product?.cgst);
  let sgst = safeNumber(product?.sgst);
  let igst = safeNumber(product?.igst);

  if (!cgst && !sgst && !igst) {
    cgst = 9;
    sgst = 9;
    igst = 18;
  }

  const taxablePricePerProduct = qty > 0 ? taxableAmt / qty : 0;

  if (taxablePricePerProduct >= 2500) {
    if (cgst === 2.5) cgst = 9;
    if (sgst === 2.5) sgst = 9;
    if (igst === 5) igst = 18;
  }

  return { cgst, sgst, igst };
};

/**
 * Mirrors importSalesOrder's buildLineItem exactly (same semantics as the
 * manual Order Entry screen), so Order Enquiry CSV imports behave identically
 * to Order Entry CSV imports:
 *
 *  - Effective Price is the actual per-unit billed price. If the uploader
 *    leaves it blank (or supplies 0 / negative / non-numeric), we bill at
 *    RLP — never at ₹0.
 *  - distributorDisc is a ₹-PER-UNIT AMOUNT (rlpPrice - effPrice), NOT
 *    clamped to >= 0. If Effective Price is uploaded higher than RLP,
 *    distributorDisc comes out negative (a markup) and taxableAmt correctly
 *    comes out ABOVE grossAmt.
 *  - Total Discount % / Amount are always measured against MRP using the
 *    actual effective price. When Effective Price isn't uploaded, effPrice
 *    defaults to RLP, so Total Discount naturally shows the baseline
 *    MRP→RLP discount every product already carries.
 */
const buildLineItem = ({
  product,
  price,
  inventory,
  qty,
  effectivePrice,
  isIgst,
}) => {
  const rlpPrice = safeNumber(price.rlp_price);
  const mrpPrice = safeNumber(price.mrp_price);
  const grossAmt = toTwoDecimal(qty * rlpPrice);

  // Effective Price actually billed. Falls back to RLP when not uploaded.
  const effPrice =
    effectivePrice !== null && qty > 0
      ? safeNumber(effectivePrice) / qty
      : rlpPrice;

  // ₹-per-unit amount, uncapped (can be negative -> markup above RLP).
  const distributorDiscUnitAmount = toTwoDecimal(rlpPrice - effPrice);
  const distributorDiscount = toTwoDecimal(distributorDiscUnitAmount * qty);

  const taxableAmt = toTwoDecimal(grossAmt - distributorDiscount);

  // Always against MRP, using the actual effective price.
  const totalDiscountPercentage =
    mrpPrice > 0
      ? toTwoDecimal(((mrpPrice - effPrice) / mrpPrice) * 100)
      : 0;
  const totalDiscountAmount = toTwoDecimal((mrpPrice - effPrice) * qty);

  const taxRate = getApplicableTaxRate({ product, taxableAmt, qty });
  const totalCGST = isIgst
    ? 0
    : toTwoDecimal(taxableAmt * (taxRate.cgst / 100));
  const totalSGST = isIgst
    ? 0
    : toTwoDecimal(taxableAmt * (taxRate.sgst / 100));
  const igstRate = taxRate.igst || taxRate.cgst + taxRate.sgst;
  const totalIGST = isIgst ? toTwoDecimal(taxableAmt * (igstRate / 100)) : 0;
  const netAmt = toTwoDecimal(taxableAmt + totalCGST + totalSGST + totalIGST);

  return {
    product: product._id,
    price: price._id,
    uom: "pcs",
    inventoryId: inventory?._id || undefined,
    oderQty: qty,
    boxOrderQty: toTwoDecimal(
      qty / safeNumber(product.no_of_pieces_in_a_box || 1),
    ),
    grossAmt,
    schemeDisc: 0,
    distributorDisc: distributorDiscUnitAmount,
    distributorDiscUnit: "amount",
    taxableAmt,
    totalDiscountPercentage,
    totalDiscountAmount,
    totalCGST,
    totalSGST,
    totalIGST,
    netAmt,
    usedBasePoint: safeNumber(product.base_point),
    goodsType: "Billed",
  };
};

const mergeRowsByProduct = (rows) => {
  const map = {};

  for (const row of rows) {
    const productCode = String(row.productCode).trim();

    if (!map[productCode]) {
      map[productCode] = { ...row };
    } else {
      const existingQty = safeNumber(map[productCode].orderQty);
      const newQty = safeNumber(row.orderQty);
      const totalQty = existingQty + newQty;

      // Weighted-average the Effective Price across merged rows for the same
      // product code. If EITHER row omitted Effective Price, we can't weight
      // it meaningfully (we don't know RLP yet at merge time), so we leave it
      // null — buildLineItem() will then fall back to RLP for the whole
      // merged quantity, same as if Effective Price had simply never been
      // supplied.
      const combinedEffectivePrice =
        map[productCode].effectivePrice !== null && row.effectivePrice !== null
          ? safeNumber(map[productCode].effectivePrice) +
            safeNumber(row.effectivePrice)
          : null;

      map[productCode].orderQty = totalQty;
      map[productCode].effectivePrice = combinedEffectivePrice;
    }
  }

  return Object.values(map);
};

const buildErrorRows = (items, reason) =>
  items.map((item) => ({ ...item.originalRow, Reason: reason }));

/* ------------------------------------------------------- group builder --- */

const createImportedEnquiry = async ({ distributor, rows, enquiryMeta }) => {
  const validationErrors = [];
  const lineItems = [];
  const isIgst = getIsIgst({ distributor, retailer: enquiryMeta.retailer });

  // regionId is raw ObjectId (not populated) — safe to toString() directly
  const regionId = distributor?.regionId?.toString() || null;

  // Parsed up-front (moved ahead of the line-item loop) so the enquiry date
  // is available to the price lookup below — pricing must be resolved
  // against THIS date, not "now".
  const manualDate = parseOrderDate(enquiryMeta.orderDate);

  if (!manualDate) {
    throw {
      message: "Invalid Enquiry Date",
      validationErrors: rows.map((row) => ({
        ...row,
        reason: `Invalid Enquiry Date ${enquiryMeta.orderDate}`,
      })),
    };
  }

  for (const item of mergeRowsByProduct(rows)) {
    const product = await Product.findOne({
      product_code: String(item.productCode).trim(),
    });

    if (!product) {
      validationErrors.push({
        ...item,
        reason: `Product not found for Product Code ${item.productCode}`,
      });
      continue;
    }

    if (!item.orderQty || item.orderQty <= 0) {
      validationErrors.push({
        ...item,
        reason: `Invalid Enquiry Quantity for Product Code ${item.productCode}`,
      });
      continue;
    }

    const price = await getPriceForProduct({
      productId: product._id,
      distributorId: distributor._id,
      regionId,
      quotationDate: manualDate,
    });

    // Reject if price missing OR rlp_price is zero
    if (!price || safeNumber(price.rlp_price) <= 0) {
      validationErrors.push({
        ...item,
        reason: !price
          ? `Price not found for Product Code ${item.productCode}`
          : `RLP price is zero for Product Code ${item.productCode}`,
      });
      continue;
    }

    const inventory = await Inventory.findOne({
      productId: product._id,
      distributorId: distributor._id,
      godownType: "main",
    });

    if (!inventory) {
      validationErrors.push({
        ...item,
        reason: `Inventory not found for Product Code ${item.productCode}`,
      });
      continue;
    }

    lineItems.push(
      buildLineItem({
        product,
        price,
        inventory,
        qty: item.orderQty,
        effectivePrice: item.effectivePrice,
        isIgst,
      }),
    );
  }

  if (!lineItems.length) {
    throw {
      message: "No valid line items",
      validationErrors: rows.map((row) => ({
        ...row,
        reason: "No valid line items",
      })),
    };
  }

  const enquiryNo = await enquiryNumberGenerator("IPPL");

  const total = (field) =>
    toTwoDecimal(
      lineItems.reduce((sum, item) => sum + safeNumber(item[field]), 0),
    );

  const totalBasePoints = toTwoDecimal(
    lineItems.reduce(
      (sum, item) =>
        sum + safeNumber(item.usedBasePoint) * safeNumber(item.oderQty),
      0,
    ),
  );

  const netAmount = total("netAmt");

  // distributorDisc is a ₹-per-unit AMOUNT (can be negative for a markup), so
  // the order-level total is simply the sum of (distributorDisc * qty) per
  // line — equivalent to total(grossAmt) - total(taxableAmt).
  const totalDistributorDiscount = toTwoDecimal(
    lineItems.reduce(
      (sum, item) =>
        sum + safeNumber(item.distributorDisc) * safeNumber(item.oderQty),
      0,
    ),
  );

  const enquiryData = {
    distributorId: distributor._id,
    enquiryNo,
    salesmanName: enquiryMeta.employee?._id,
    retailerId: enquiryMeta.retailer._id,
    cso: enquiryMeta.retailer?.cso ?? null,
    orderType: enquiryMeta.orderType,
    orderSource: "Distributor",
    paymentMode: enquiryMeta.paymentMode,
    manualDate,
    lineItems,
    totalLines: lineItems.length,
    totalBasePoints,
    grossAmount: total("grossAmt"),
    schemeDiscount: 0,
    distributorDiscount: totalDistributorDiscount,
    freightCharges: 0,
    handlingCharges: 0,
    taxableAmount: total("taxableAmt"),
    cgst: total("totalCGST"),
    sgst: total("totalSGST"),
    igst: total("totalIGST"),
    invoiceAmount: netAmount,
    roundOffAmount: Number(netAmount.toFixed(0)),
    cashDiscount: 0,
    cashDiscountApplied: false,
    cashDiscountType: "amount",
    cashDiscountValue: 0,
    creditAmount: 0,
    netAmount: Number(netAmount.toFixed(0)),
    adjustedCreditNoteIds: [],
  };

  const createdEnquiry = await OrderEnquiry.create(enquiryData);

  return {
    enquiry: createdEnquiry,
    validationErrors,
  };
};

/* ---------------------------------------------------------- controller --- */

const bulkCreateOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No data provided" });
    }

    const distributorId = req.user.id;

    // Only populate stateId — regionId stays as raw ObjectId
    const distributor =
      await Distributor.findById(distributorId).populate("stateId");

    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }

    const grouped = {};
    const errorCsv = [];
    let skippedRowCount = 0;

    for (const row of rows) {
      if (isBlankRow(row)) continue;

      const salesmanCode = String(getFirstValue(row, ["Salesman Code"])).trim();
      const retailerCode = String(getFirstValue(row, ["Retailer Code"])).trim();
      const retailerName = String(getFirstValue(row, ["Retailer Name"])).trim();
      // "Enquiry Date" is the current CSV header; "Order Date" kept as a
      // fallback so previously-downloaded/older sheets keep working.
      const orderDate = getFirstValue(row, ["Enquiry Date", "Order Date"]);
      const productCode = String(getFirstValue(row, ["Product Code"])).trim();
      // "Enquiry Quantity" is the current CSV header; "Order Quantity" kept
      // as a fallback for the same reason.
      const orderQty = safeNumber(
        getFirstValue(row, ["Enquiry Quantity", "Order Quantity"]),
      );
      const orderType = ["Counter", "Normal-Sale"].includes(
        getFirstValue(row, ["Order Type"]),
      )
        ? getFirstValue(row, ["Order Type"])
        : DEFAULT_ORDER_TYPE;
      const paymentMode = ["Cash", "Credit"].includes(
        getFirstValue(row, ["Payment Mode"]),
      )
        ? getFirstValue(row, ["Payment Mode"])
        : DEFAULT_PAYMENT_MODE;
      // Positive-only: a 0, negative, or non-numeric Effective Price in the
      // sheet is treated as "not supplied" and falls back to RLP.
      const effectivePrice = safeOptionalPositiveNumber(
        getFirstValue(row, ["Effective Price"]),
      );
      const remark = String(getFirstValue(row, ["Remark"])).trim();

      // Retailer Code and Product Code are required for an enquiry row;
      // Salesman Code is optional (mirrors the manual enquiry screen, which
      // allows an unassigned enquiry).
      if (!retailerCode || !retailerName || !productCode) {
        skippedRowCount += 1;
        errorCsv.push({
          ...row,
          Reason: "Retailer Code, Retailer Name and Product Code are required",
        });
        continue;
      }

      const groupKey = [
        salesmanCode,
        retailerCode,
        orderDate || "",
        orderType,
        paymentMode,
      ].join("||");

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          salesmanCode,
          retailerCode,
          orderDate,
          orderType,
          paymentMode,
          rows: [],
        };
      }

      grouped[groupKey].rows.push({
        productCode,
        orderQty,
        effectivePrice,
        retailerName,
        remark,
        originalRow: row,
      });
    }

    const results = [];
    const errors = [];

    for (const group of Object.values(grouped)) {
      try {
        let employee = null;

        if (group.salesmanCode) {
          employee = await Employee.findOne({
            empId: group.salesmanCode,
            status: true,
          });

          if (!employee) {
            throw {
              message: `Salesman not found for Salesman Code ${group.salesmanCode}`,
              validationErrors: group.rows.map((row) => ({
                ...row,
                reason: `Salesman not found for Salesman Code ${group.salesmanCode}`,
              })),
            };
          }
        }

        let retailer = await OutletApproved.findOne({
          $or: [
            { outletCode: group.retailerCode },
            { outletUID: group.retailerCode },
          ],
          status: true,
        }).populate("stateId");

        if (!retailer) {
          retailer = await OutletApproved.findOne({
            massistRefIds: group.retailerCode,
            status: true,
          }).populate("stateId");
        }

        if (!retailer) {
          throw {
            message: `Retailer not found for Retailer Code/UID ${group.retailerCode}`,
            validationErrors: group.rows.map((row) => ({
              ...row,
              reason: `Retailer not found for Retailer Code/UID ${group.retailerCode}`,
            })),
          };
        }

        const { enquiry, validationErrors } = await createImportedEnquiry({
          distributor,
          rows: group.rows,
          enquiryMeta: {
            employee,
            retailer,
            orderDate: group.orderDate,
            orderType: group.orderType,
            paymentMode: group.paymentMode,
            remark: group.rows[0]?.remark || "",
          },
        });

        results.push({
          enquiryNo: enquiry.enquiryNo,
          salesmanCode: group.salesmanCode,
          retailerCode: group.retailerCode,
          lineItems: enquiry.lineItems.length,
          message: "Order enquiry created",
        });

        if (validationErrors.length) {
          validationErrors.forEach((item) => {
            errorCsv.push({
              ...item.originalRow,
              Reason: item.reason,
            });
          });
        }
      } catch (error) {
        errors.push({
          salesmanCode: group.salesmanCode,
          retailerCode: group.retailerCode,
          message: error.message || "Order enquiry import failed",
        });

        if (
          Array.isArray(error.validationErrors) &&
          error.validationErrors.length
        ) {
          error.validationErrors.forEach((item) => {
            errorCsv.push({
              ...item.originalRow,
              Reason: item.reason || error.message || "Validation failed",
            });
          });
        } else {
          errorCsv.push(...buildErrorRows(group.rows, error.message));
        }
      }
    }

    return res.status(200).json({
      message: "Bulk order enquiry processed",
      successCount: results.length,
      failedCount: errors.length + skippedRowCount,
      results,
      errors,
      errorCsv,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = { bulkCreateOrderEnquiry };