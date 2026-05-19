const asyncHandler = require("express-async-handler");
const moment = require("moment");
const OrderEntry = require("../../models/orderEntry.model");
const Distributor = require("../../models/distributor.model");
const Employee = require("../../models/employee.model");
const OutletApproved = require("../../models/outletApproved.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { orderNumberGeneratorNew } = require("../../utils/codeGenerator");

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

const parseOrderDate = (value) => {
  if (!value) {
    return new Date();
  }

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
    true,
  );

  if (!parsed.isValid()) {
    return null;
  }

  return parsed.startOf("day").toDate();
};

const getPriceForProduct = async ({ productId, distributorId }) => {
  let price = await Price.findOne({
    productId,
    distributorId,
    status: true,
  }).sort({ createdAt: -1 });

  if (!price) {
    price = await Price.findOne({
      productId,
      price_type: "national",
      status: true,
    }).sort({ createdAt: -1 });
  }

  return price;
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

const buildLineItem = ({
  product,
  price,
  inventory,
  qty,
  specialDiscount,
  isIgst,
}) => {
  const grossAmt = toTwoDecimal(qty * safeNumber(price.rlp_price));
  const distributorDiscountPercent = Math.min(
    Math.max(safeNumber(specialDiscount), 0),
    100,
  );
  const distributorDiscount = toTwoDecimal(
    grossAmt * (distributorDiscountPercent / 100),
  );
  const taxableAmt = toTwoDecimal(grossAmt - distributorDiscount);
  const taxRate = getApplicableTaxRate({ product, taxableAmt, qty });
  const totalCGST = isIgst ? 0 : toTwoDecimal(taxableAmt * (taxRate.cgst / 100));
  const totalSGST = isIgst ? 0 : toTwoDecimal(taxableAmt * (taxRate.sgst / 100));
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
    distributorDisc: distributorDiscountPercent,
    distributorDiscUnit: "percent",
    taxableAmt,
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
      const weightedDiscount =
        totalQty > 0
          ? (safeNumber(map[productCode].specialDiscount) * existingQty +
              safeNumber(row.specialDiscount) * newQty) /
            totalQty
          : 0;

      map[productCode].orderQty += row.orderQty;
      map[productCode].specialDiscount = weightedDiscount;
    }
  }

  return Object.values(map);
};

const buildErrorRows = (items, reason) =>
  items.map((item) => ({
    ...item.originalRow,
    Reason: reason,
  }));

const createImportedOrder = async ({ distributor, rows, orderMeta }) => {
  const validationErrors = [];
  const lineItems = [];
  const distributorStateId = distributor?.stateId;
  const retailerStateId = orderMeta.retailer?.stateId;
  const isIgst =
    distributorStateId &&
    retailerStateId &&
    String(distributorStateId) !== String(retailerStateId);

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
    });

    if (!price || !price.rlp_price) {
      validationErrors.push({
        ...item,
        reason: `Price not found for Product Code ${item.productCode}`,
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
        specialDiscount: item.specialDiscount,
        isIgst,
      }),
    );
  }

  if (validationErrors.length > 0) {
    throw {
      message: "Sales order cancelled due to validation errors",
      validationErrors: rows.map((row) => {
        const matchedErrors = validationErrors
          .filter(
            (error) =>
              String(error.productCode).trim() ===
              String(row.productCode).trim(),
          )
          .map((error) => error.reason);

        return {
          ...row,
          reason:
            matchedErrors.length > 0
              ? matchedErrors.join(" | ")
              : "Cancelled because another product in same order failed",
        };
      }),
    };
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

  const total = (field) =>
    toTwoDecimal(lineItems.reduce((sum, item) => sum + safeNumber(item[field]), 0));
  const totalBasePoints = toTwoDecimal(
    lineItems.reduce(
      (sum, item) => sum + safeNumber(item.usedBasePoint) * safeNumber(item.oderQty),
      0,
    ),
  );
  const netAmount = total("netAmt");
  const totalDistributorDiscount = toTwoDecimal(
    lineItems.reduce(
      (sum, item) =>
        sum + safeNumber(item.grossAmt) * (safeNumber(item.distributorDisc) / 100),
      0,
    ),
  );
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

  const orderNo = await orderNumberGeneratorNew("ORD");
  const orderData = {
    distributorId: distributor._id,
    orderNo,
    salesmanName: orderMeta.employee._id,
    routeId: orderMeta.routeId,
    retailerId: orderMeta.retailer._id,
    orderType: orderMeta.orderType,
    orderSource: "Distributor",
    paymentMode: orderMeta.paymentMode,
    lineItems,
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
    await OrderEntry.findByIdAndUpdate(createdOrder._id, {
      createdAt: orderDate,
      updatedAt: orderDate,
    });
    createdOrder.createdAt = orderDate;
    createdOrder.updatedAt = orderDate;
  }

  return createdOrder;
};

const importSalesOrder = asyncHandler(async (req, res) => {
  try {
    const rows = req.body.data;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No data provided" });
    }

    const distributorId = req.user.id;
    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }

    const grouped = {};
    const errorCsv = [];
    let skippedRowCount = 0;

    for (const row of rows) {
      const salesmanCode = String(
        getFirstValue(row, ["Salesman Code", "salesmanCode", "empId"]),
      ).trim();
      const retailerCode = String(
        getFirstValue(row, ["Retailer Code", "retailerCode", "outletCode"]),
      ).trim();
      const orderDate = getFirstValue(row, ["Order Date", "orderDate"]);
      const productCode = String(
        getFirstValue(row, ["Product Code", "productCode"]),
      ).trim();
      const orderQty = safeNumber(
        getFirstValue(row, ["Order Quantity", "orderQuantity", "orderQty"]),
      );
      const orderType = DEFAULT_ORDER_TYPE;
      const paymentMode = DEFAULT_PAYMENT_MODE;
      const specialDiscount = safeNumber(
        getFirstValue(row, [
          "Special Discount (%)",
          "Special Discount",
          "specialDiscount",
          "special_discount",
        ]),
      );

      if (!salesmanCode || !retailerCode || !productCode) {
        skippedRowCount += 1;
        errorCsv.push({
          ...row,
          Reason: "Salesman Code, Retailer Code and Product Code are required",
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
        specialDiscount,
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
        });

        if (!retailer) {
          retailer = await OutletApproved.findOne({
            massistRefIds: group.retailerCode,
            status: true,
          });
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

        const order = await createImportedOrder({
          distributor,
          rows: group.rows,
          orderMeta: {
            employee,
            retailer,
            routeId,
            orderDate: group.orderDate,
            orderType: group.orderType,
            paymentMode: group.paymentMode,
          },
        });

        results.push({
          orderNo: order.orderNo,
          salesmanCode: group.salesmanCode,
          retailerCode: group.retailerCode,
          lineItems: order.lineItems.length,
          message: "Sales order created",
        });
      } catch (error) {
        errors.push({
          salesmanCode: group.salesmanCode,
          retailerCode: group.retailerCode,
          message: error.message || "Sales order import failed",
        });

        if (Array.isArray(error.validationErrors) && error.validationErrors.length) {
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
