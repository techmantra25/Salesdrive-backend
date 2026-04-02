const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const OrderEntry = require("../../models/orderEntry.model");

// Helper function to escape CSV values
const escapeCSVValue = (value) => {
  if (value == null || value === undefined) return "";
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const generateSalesOrderReport = asyncHandler(async (req, res) => {
  try {
    // ✅ CSV headers
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=sales-order-report.csv"
    );

    // -------------------- FILTERS --------------------
    const {
      distributorIds,
      search,
      orderSource,
      status,
      paymentMode,
      fromDate,
      toDate,
    } = req.query;

    const filter = {};

    if (distributorIds) {
      filter.distributorId = { $in: distributorIds.split(",") };
    }

    if (search) {
      filter.orderNo = new RegExp(search, "i");
    }

    if (orderSource && orderSource !== "all") {
      filter.orderSource = orderSource;
    }

    if (status && status !== "all") {
      filter.status = status;
    }

    if (paymentMode && paymentMode !== "all") {
      filter.paymentMode = paymentMode;
    }

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    // -------------------- POPULATION --------------------
    const populateFields = [
      {
        path: "distributorId",
        select: "dbCode name stateId city",
        populate: {
          path: "stateId",
          select: "name zoneId",
          populate: {
            path: "zoneId",
            select: "name",
          },
        },
      },
      {
        path: "salesmanName",
        select: "empId name empMappingId",
        populate: {
          path: "empMappingId",
          select: "rmEmpId",
          populate: {
            path: "rmEmpId",
            select: "empId name",
          },
        },
      },
      { path: "routeId", select: "code name" },
      {
        path: "retailerId",
        select: "outletCode outletUID outletName",
      },
      {
        path: "lineItems.product",
        select:
          "product_code name sku_group_id sku_group__name no_of_pieces_in_a_box brand subBrand cat_id",
        populate: [
          { path: "brand", select: "name" },
          { path: "subBrand", select: "name" },
          { path: "cat_id", select: "name" },
        ],
      },
      {
        path: "lineItems.price",
        select: "mrp_price rlp_price",
      },
      {
        path: "lineItems",
        select: "oderQty grossAmt schemeDisc distributorDisc netAmt",
      },
    ];

    // -------------------- CSV HEADERS --------------------
    const headers = [
      "Distributor ID",
      "Distributor Name",
      "Distributor's Zone",
      "Distributor's State",
      "Distributor's City",
      "Order Number",
      "Order Date",
      "Order Source",
      "Salesman Code",
      "Salesman Name",
      "Reporting Manager",
      "Beat Code",
      "Beat",
      "Retailer Code",
      "Retailer UID",
      "Retailer",
      "Brand",
      "Sub Brand",
      "Category",
      "Group",
      "FG Code",
      "Product Code",
      "Product Name",
      "Order Qty (Pcs)",
      "Order Qty (BOX)",
      "MRP",
      "RLP",
      "Gross Amount",
      "Scheme Discount",
      "Special Disc Amount",
      "Net Amount",
      "Order to Bill Status",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // -------------------- CURSOR --------------------
    const cursor = OrderEntry.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .lean()
      .cursor();

    cursor.on("data", (order) => {
      order.lineItems.forEach((item) => {
        const qtyPcs = item?.oderQty || 0;
        const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box || 1);
        const qtyBox = (qtyPcs / piecesPerBox).toFixed(2);

        const statusLabel =
          order.status === "Partially_Billed"
            ? "Partially Billed"
            : order.status === "Completed_Billed"
            ? "Completely Billed"
            : order.status;

        csvStream.write({
          "Distributor ID": order.distributorId?.dbCode || "",
          "Distributor Name": escapeCSVValue(order.distributorId?.name),
          "Distributor's Zone": order.distributorId?.stateId?.zoneId?.name || "",
          "Distributor's State": order.distributorId?.stateId?.name || "",
          "Distributor's City": order.distributorId?.city || "",
          "Order Number": order.orderNo || "",
          "Order Date": moment(order.updatedAt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY"),
          "Order Source": order.orderSource || "",
          "Salesman Code": order.salesmanName?.empId || "",
          "Salesman Name": order.salesmanName?.name || "",
          "Reporting Manager": order.salesmanName?.empMappingId?.rmEmpId?.name || "",
          "Beat Code": order.routeId?.code || "",
          Beat: order.routeId?.name || "",
          "Retailer Code": order.retailerId?.outletCode || "",
          "Retailer UID": order.retailerId?.outletUID || "",
          Retailer: order.retailerId?.outletName || "",
          Brand: item?.product?.brand?.name || "",
          "Sub Brand": item?.product?.subBrand?.name || "",
          Category: item?.product?.cat_id?.name || "",
          Group: escapeCSVValue(item?.product?.sku_group__name || ""),
          "FG Code": item?.product?.sku_group_id || "",
          "Product Code": item?.product?.product_code || "",
          "Product Name": escapeCSVValue(item?.product?.name || ""),
          "Order Qty (Pcs)": item?.oderQty || 0,
          "Order Qty (BOX)": qtyBox,
          MRP: item?.price?.mrp_price || 0,
          RLP: item?.price?.rlp_price || 0,
          "Gross Amount": item?.grossAmt || 0,
          "Scheme Discount": item?.schemeDisc || 0,
          "Special Disc Amount": item?.distributorDisc || 0,
          "Net Amount": item?.netAmt || 0,
          "Order to Bill Status": statusLabel,
        });
      });
    });

    cursor.on("end", () => {
      csvStream.end();
    });

    cursor.on("error", (err) => {
      console.error("CSV Generation Error:", err);
      csvStream.end();
      res.status(500).send("Error generating report");
    });
  } catch (error) {
    console.error("generateSalesOrderReport error:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { generateSalesOrderReport };