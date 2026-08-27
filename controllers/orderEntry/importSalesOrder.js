const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const OrderEntry = require("../../models/orderEntry.model");
const Distributor = require("../../models/distributor.model");
const Employee = require("../../models/employee.model");
const OutletApproved = require("../../models/outletApproved.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const Godown = require("../../models/godown.model");
const { orderNumberGeneratorNew } = require("../../utils/codeGenerator");

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
 * order from the CSV's Order Date column), we:
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
 * Mirrors the manual "Order Entry" screen exactly (EntryProductCatalogue.jsx):
 *
 *  - Effective Price is the actual per-unit billed price. If the uploader leaves it
 *    blank, we bill at RLP (no discount, no markup) — same as never touching the
 *    "Effective Price" box on the manual entry screen.
 *  - The Special/Distributor Discount is stored as a ₹-PER-UNIT AMOUNT
 *    (distributorDiscUnit = "amount"), exactly like handleBillPriceChange() does:
 *        distributorDisc = rlpPrice - effectivePrice
 *    This is intentionally NOT clamped to >= 0. If Effective Price is uploaded
 *    HIGHER than RLP, distributorDisc comes out negative (a markup), and taxableAmt
 *    correctly comes out ABOVE grossAmt — exactly like the "-9.46" example in the UI
 *    where Effective Price (140) > Base Rate (130.54).
 *  - Total Discount % / Amount are always measured against MRP using the actual
 *    effective price, matching getTotalDiscountData() on the manual entry screen.
 *    When Effective Price isn't uploaded, effPrice defaults to RLP, so Total Discount
 *    naturally shows the baseline MRP→RLP discount every product already carries.
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
    inventoryId: inventory?._id || null,
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
      // product code. If EITHER row omitted Effective Price, we can't weight it
      // meaningfully (we don't know RLP yet at merge time), so we leave it null —
      // buildLineItem() will then fall back to RLP for the whole merged quantity,
      // same as if Effective Price had simply never been supplied.
      const combinedEffectivePrice =
        map[productCode].effectivePrice !== null && row.effectivePrice !== null
          ? safeNumber(map[productCode].effectivePrice) +
          safeNumber(row.effectivePrice)
          : null;

      map[productCode].orderQty += row.orderQty;
      map[productCode].effectivePrice = combinedEffectivePrice;
    }
  }

  return Object.values(map);
};

const buildErrorRows = (items, reason) =>
  items.map((item) => ({ ...item.originalRow, Reason: reason }));

const createImportedOrder = async ({ distributor, rows, orderMeta }) => {
  const validationErrors = [];
  const lineItems = [];
  const isIgst = getIsIgst({ distributor, retailer: orderMeta.retailer });

  // regionId is raw ObjectId (not populated) — safe to toString() directly
  const regionId = distributor?.regionId?.toString() || null;

  // Parsed up-front (moved ahead of the line-item loop) so the order date
  // is available to the price lookup below — pricing must be resolved
  // against THIS date, not "now".
  const orderDate = parseOrderDate(orderMeta.orderDate);

  if (!orderDate) {
    throw {
      message: "Invalid Order Date",
      validationErrors: rows.map((row) => ({
        ...row,
        reason: `Invalid Order Date ${orderMeta.orderDate}`,
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
        reason: `Invalid Order Quantity for Product Code ${item.productCode}`,
      });
      continue;
    }

    const price = await getPriceForProduct({
      productId: product._id,
      distributorId: distributor._id,
      regionId,
      quotationDate: orderDate,
    });

    // ✅ Reject if price missing OR rlp_price is zero
    if (!price || safeNumber(price.rlp_price) <= 0) {
      validationErrors.push({
        ...item,
        reason: !price
          ? `Price not found for Product Code ${item.productCode}`
          : `RLP price is zero for Product Code ${item.productCode}`,
      });
      continue;
    }

    // Resolve inventory against the SAME godown this order is placed
    // against (orderMeta.godownId, from the CSV's Godown Code). This must
    // mirror EntryProductCatalogue.jsx's manual-entry resolution — falling
    // back to godownType "main" only when no Godown Code was supplied.
    // Using the wrong godown here silently attaches an unrelated godown's
    // inventoryId to the line item, and createSingleBill's stock check
    // trusts that inventoryId as-is — so a bill can pass and be delivered
    // even when the actually-ordered godown has zero stock.
    const inventory = orderMeta.godownId
      ? await Inventory.findOne({
          productId: product._id,
          distributorId: distributor._id,
          godownId: orderMeta.godownId,
        })
      : await Inventory.findOne({
          productId: product._id,
          distributorId: distributor._id,
          godownType: "main",
        });

    if (!inventory) {
      validationErrors.push({
        ...item,
        reason: orderMeta.godownId
          ? `Inventory not found for Product Code ${item.productCode} in the specified Godown`
          : `Inventory not found for Product Code ${item.productCode}`,
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

  const orderNo = await orderNumberGeneratorNew("ORD");

  if (!lineItems.length) {
    throw {
      message: "No valid line items",
      validationErrors: rows.map((row) => ({
        ...row,
        reason: "No valid line items",
      })),
    };
  }

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

  // distributorDisc is now a ₹-per-unit AMOUNT (can be negative for a markup),
  // so the order-level total is simply the sum of (distributorDisc * qty) per line —
  // equivalent to total(grossAmt) - total(taxableAmt).
  const totalDistributorDiscount = toTwoDecimal(
    lineItems.reduce(
      (sum, item) =>
        sum + safeNumber(item.distributorDisc) * safeNumber(item.oderQty),
      0,
    ),
  );

  const orderData = {
    distributorId: distributor._id,
    orderNo,
    salesmanName: orderMeta.employee._id,
    routeId: orderMeta.routeId,
    retailerId: orderMeta.retailer._id,
    godownId: orderMeta.godownId ?? null,
    cso: orderMeta.retailer?.cso ?? null,
    orderType: orderMeta.orderType,
    orderSource: "Distributor",
    paymentMode: orderMeta.paymentMode,
    lineItems,
    remark: orderMeta.remark || "",
    totalLines: lineItems.length,
    totalBasePoints,
    grossAmount: total("grossAmt"),
    schemeDiscount: 0,
    distributorDiscount: totalDistributorDiscount,
    taxableAmount: total("taxableAmt"),
    cgst: total("totalCGST"),
    sgst: total("totalSGST"),
    igst: total("totalIGST"),
    invoiceAmount: netAmount,
    roundOffAmount: Number(netAmount.toFixed(0)),
    cashDiscount: 0,
    netAmount: Number(netAmount.toFixed(0)),
  };

  const createdOrder = await OrderEntry.create(orderData);

  if (orderDate) {
    await OrderEntry.collection.updateOne(
      { _id: createdOrder._id },
      {
        $set: {
          manualOrderDate: orderDate,
          updatedAt: orderDate,
        },
      }
    );

    createdOrder.manualOrderDate = orderDate;
    createdOrder.updatedAt = orderDate;
  }

  return {
    order: createdOrder,
    validationErrors,
  };
};

const importSalesOrder = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No data provided" });
    }

    const distributorId = req.user.id;

    // ✅ Only populate stateId — regionId stays as raw ObjectId
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
      const orderDate = getFirstValue(row, ["Order Date"]);
      const godownCode = String(
        getFirstValue(row, ["Godown Code"]),
      ).trim();
      const productCode = String(getFirstValue(row, ["Product Code"])).trim();
      const orderQty = safeNumber(getFirstValue(row, ["Order Quantity"]));
      const orderType = DEFAULT_ORDER_TYPE;
      const paymentMode = DEFAULT_PAYMENT_MODE;
      // Positive-only: a 0 or negative Effective Price in the sheet is treated as
      // "not supplied" and falls back to RLP, same guard as before.
      const effectivePrice = safeOptionalPositiveNumber(
        getFirstValue(row, ["Effective Price"]),
      );
      const netAmount = safeOptionalPositiveNumber(
        getFirstValue(row, ["Net Amt ( Incl. GST)"]),
      );
      const remark = String(getFirstValue(row, ["Remark"])).trim();

      if (!salesmanCode || !retailerCode || !retailerName || !productCode) {
        skippedRowCount += 1;
        errorCsv.push({
          ...row,
          Reason:
            "Salesman Code, Retailer Code, Retailer Name and Product Code are required",
        });
        continue;
      }

      // Godown Code is optional — rows for the same salesman/retailer/date but
      // different godown codes are split into separate orders, same as if the
      // Order Date differed.
      const groupKey = [
        salesmanCode,
        retailerCode,
        orderDate || "",
        godownCode || "",
        orderType,
        paymentMode,
      ].join("||");

      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          salesmanCode,
          retailerCode,
          orderDate,
          godownCode,
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
        netAmount,
        remark,
        originalRow: row,
      });
    }

    const results = [];
    const errors = [];

    for (const group of Object.values(grouped)) {
      try {
        const employee = await Employee.findOne({
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

        const routeId = Array.isArray(retailer.beatId)
          ? retailer.beatId[0]
          : retailer.beatId;

        if (!routeId) {
          throw {
            message: `Beat not found for Retailer Code ${group.retailerCode}`,
            validationErrors: group.rows.map((row) => ({
              ...row,
              reason: `Beat not found for Retailer Code ${group.retailerCode}`,
            })),
          };
        }

        // Godown Code is optional. When supplied, it must resolve to an
        // active godown belonging to this distributor (mirrors the
        // distributorId+godownCode uniqueness on the Godown model).
        let godownId = null;
        if (group.godownCode) {
          const godown = await Godown.findOne({
            distributorId: distributor._id,
            godownCode: group.godownCode,
            isActive: true,
          });

          if (!godown) {
            throw {
              message: `Godown not found for Godown Code ${group.godownCode}`,
              validationErrors: group.rows.map((row) => ({
                ...row,
                reason: `Godown not found for Godown Code ${group.godownCode}`,
              })),
            };
          }

          godownId = godown._id;
        }

        const { order, validationErrors } = await createImportedOrder({
          distributor,
          rows: group.rows,
          orderMeta: {
            employee,
            retailer,
            routeId,
            godownId,
            orderDate: group.orderDate,
            orderType: group.orderType,
            paymentMode: group.paymentMode,
            remark: group.rows[0]?.remark || "",
          },
        });

        results.push({
          orderNo: order.orderNo,
          salesmanCode: group.salesmanCode,
          retailerCode: group.retailerCode,
          lineItems: order.lineItems.length,
          message: "Sales order created",
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
          message: error.message || "Sales order import failed",
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
      message: "Bulk sales order processed",
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

module.exports = { importSalesOrder };