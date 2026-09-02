const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const OrderEnquiry = require("../../models/orderEnquiry.model");

// Helper function to escape CSV values
const escapeCSVValue = (value) => {
  if (value == null || value === undefined) return "";
  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const generateSalesEnquiryReport = asyncHandler(async (req, res) => {
  try {
    // ✅ CSV headers
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=sales-enquiry-report.csv",
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
      salesmanName,
      routeId,
      retailerId,
      godownId,
      godownIds,
    } = req.query;

    const filter = {};

    if (distributorIds) {
      filter.distributorId = { $in: distributorIds.split(",") };
    }
    if (salesmanName) {
      filter.salesmanName = {
        $in: salesmanName.split(","),
      };
    }

    if (routeId) {
      filter.routeId = {
        $in: routeId.split(","),
      };
    }

    if (retailerId) {
      filter.retailerId = {
        $in: retailerId.split(","),
      };
    }

    if (godownId) {
      filter.godownId = godownId;
    } else if (godownIds && godownIds !== "all") {
      filter.godownId = {
        $in: godownIds.split(",").map((id) => id.trim()),
      };
    }

    if (search) {
      filter.enquiryNo = new RegExp(search, "i");
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
      { path: "godownId", select: "godownCode godownName" },
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
        select: "outletCode outletName",
      },
      {
        path: "lineItems.product",
        select:
          "product_code name sku_group_id sku_group__name no_of_pieces_in_a_box brand subBrand cat_id product_type",
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
      {
        path: "convertedOrderEntryId",
        select: "orderNo",
      },
    ];

    // -------------------- CSV HEADERS --------------------
    const headers = [
      "Distributor ID",
      "Distributor Name",
      // "Distributor's Zone",
      "Distributor's State",
      "Distributor's City",
      "Godown Code",
      "Godown Name",
      "Enquiry Number",
      "Enquiry Date",
      "Order Source",
      "Salesman Code",
      "Salesman Name",
      "Reporting Manager",
      "Beat Code",
      "Beat",
      "Retailer Code",
      // "Retailer UID",
      "Retailer",
      "Brand",
      "Segment",
      "Product Type",
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
      "Freight And Delivery Charges",
      "Handling Charges",
      "Scheme Discount",
      "Special Disc Amount",
      "Total Disc %",
      "Basic Value",
      "Net Amount (Incl. Amt)",
      "Enquiry to Order Status",
      "Converted Order No",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // -------------------- CURSOR --------------------
    const cursor = OrderEnquiry.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .lean()
      .cursor();

    cursor.on("data", (enquiry) => {
      enquiry.lineItems.forEach((item) => {
        const qtyPcs = item?.oderQty || 0;
        const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box || 1);
        const qtyBox = (qtyPcs / piecesPerBox).toFixed(2);

        const statusLabel =
          enquiry.status === "Converted"
            ? "Converted"
            : enquiry.status === "Closed"
              ? "Closed"
              : enquiry.status;

        csvStream.write({
          "Distributor ID": enquiry.distributorId?.dbCode || "",
          "Distributor Name": escapeCSVValue(enquiry.distributorId?.name),
          // "Distributor's Zone":
          //   enquiry.distributorId?.stateId?.zoneId?.name || "",
          "Distributor's State": enquiry.distributorId?.stateId?.name || "",
          "Distributor's City": enquiry.distributorId?.city || "",
          "Godown Code": enquiry.godownId?.godownCode || "",
          "Godown Name": escapeCSVValue(enquiry.godownId?.godownName || ""),
          "Enquiry Number": enquiry.enquiryNo || "",
          "Enquiry Date": moment(enquiry.updatedAt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY"),
          "Order Source": enquiry.orderSource || "",
          "Salesman Code": enquiry.salesmanName?.empId || "",
          "Salesman Name": enquiry.salesmanName?.name || "",
          "Reporting Manager":
            enquiry.salesmanName?.empMappingId?.rmEmpId?.name || "",
          "Beat Code": enquiry.routeId?.code || "",
          Beat: enquiry.routeId?.name || "",
          "Retailer Code": enquiry.retailerId?.outletCode || "",
          // "Retailer UID": enquiry.retailerId?.outletUID || "",
          Retailer: enquiry.retailerId?.outletName || "",
          Brand: item?.product?.brand?.name || "",
          "Segment": item?.product?.subBrand?.name || "",
          "Product Type": item?.product?.product_type || "",
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
          "Freight And Delivery Charges": enquiry.freightCharges || 0,
          "Handling Charges": enquiry.handlingCharges || 0,
          "Scheme Discount": item?.schemeDisc || 0,
          "Special Disc Amount": item?.distributorDisc || 0,
          "Total Disc %": item?.totalDiscountPercentage
            ? `${Number(item.totalDiscountPercentage).toFixed(2)}%`
            : "0.00%",
          "Basic Value": Number(item?.taxableAmt || 0).toFixed(2),
          "Net Amount (Incl. Amt)": item?.netAmt || 0,
          "Enquiry to Order Status": statusLabel,
          "Converted Order No": enquiry.convertedOrderEntryId?.orderNo || "",
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
    console.error("generateSalesEnquiryReport error:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { generateSalesEnquiryReport };