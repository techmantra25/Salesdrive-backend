const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const SalesReturn = require("../../models/salesReturn.model");

const generateSalesReturnReport = asyncHandler(async (req, res) => {
  try {
    // Set HTTP headers for CSV download - no filename specified
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment"); // Remove filename from here

    // --- Start Filtering Logic ---
    const filter = {};

    // Distributor filter
    if (req.query.distributorId) {
      filter.distributorId = req.query.distributorId;
    }
    if (req.query.distributorIds) {
      const distributorIds = req.query.distributorIds.split(",");
      if (distributorIds.length > 0) {
        filter.distributorId = { $in: distributorIds };
      }
    }

    // Retailer filter
    if (req.query.retailerId) {
      filter.retailerId = req.query.retailerId;
    }

    // Salesman filter
    if (req.query.salesmanName) {
      filter.salesmanName = req.query.salesmanName;
    }

    // Date range filter for Sales Return creation date
    if (req.query.startDate && req.query.endDate) {
      const startOfDay = new Date(req.query.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(req.query.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }
    // --- End Filtering Logic ---

    // Define which related documents to populate
    const populateFields = [
      {
        path: "distributorId",
        select: "dbCode name RBPSchemeMapped city stateId",
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
      { path: "retailerId", select: "outletUID outletName" },
      { path: "billId" },
      {
        path: "lineItems.product",
        select:
          "product_code name sku_group_id product_hsn_code base_point brand subBrand",
        populate: [
          {
            path: "brand",
            select: "code name",
          },
          {
            path: "subBrand",
            select: "name",
          },
        ],
      },
      { path: "lineItems.price", select: "rlp_price" },
    ];

    // Define CSV headers as requested
    const headers = [
      "Date",
      "Sales Return No",
      "Bill No",
      "Bill Delivery Date",
      "Order No",
      "Distributor Code",
      "Distributor Name",
      "Distributor's Zone",
      "Distributor's State",
      "Distributor's City",
      "Retailer UID",
      "Retailer Name",
      "Product Code",
      "Product Name",
      "SKU Group Code",
      "Brand Code",
      "Sub Brand",
      "Product HSN Code",
      "RLP",
      "Bill Qty",
      "Return Qty",
      "Gross Amount",
      "Taxable Amount",
      "CGST",
      "SGST",
      "IGST",
      "Net Amount",
      "Base Point",
      "Remark",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Use a cursor for memory-efficient processing of large datasets
    const cursor = SalesReturn.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .batchSize(1000)
      .cursor();

    // Process each document from the cursor
    cursor.on("data", (salesReturn) => {
      // Create a new CSV row for each line item in the sales return
      salesReturn.lineItems.forEach((item) => {
        const isRBPSchemed =
          salesReturn?.distributorId?.RBPSchemeMapped === "yes";
        const basePoint = isRBPSchemed
          ? Number(
              Number(item?.usedBasePoint ?? item?.product?.base_point ?? 0) *
                Number(item?.returnQty ?? 0),
            )
          : 0;
        csvStream.write({
          Date: salesReturn.createdAt
            ? moment(salesReturn.createdAt)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY")
            : "",
          "Sales Return No": salesReturn.salesReturnNo || "",
          "Bill No":
            salesReturn.billId?.new_billno || salesReturn.billId?.billNo || "",
          "Bill Delivery Date": salesReturn.billId?.dates?.deliveryDate
            ? moment(salesReturn.billId.dates.deliveryDate)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY")
            : "",
          "Order No": salesReturn.billId?.orderNo || "",
          "Distributor Code": salesReturn.distributorId?.dbCode || "",
          "Distributor Name": salesReturn.distributorId?.name || "",
          "Distributor's Zone": salesReturn.distributorId?.stateId?.zoneId?.name || "",
          "Distributor's State": salesReturn.distributorId?.stateId?.name || "",
          "Distributor's City": salesReturn.distributorId?.city || "",
          "Retailer UID": salesReturn.retailerId?.outletUID || "",
          "Retailer Name": salesReturn.retailerId?.outletName || "",
          "Product Code": item.product?.product_code || "",
          "Product Name": item.product?.name || "",
          "SKU Group Code": item.product?.sku_group_id || "",
          "Brand Code": item.product?.brand?.code || "",
          "Sub Brand": item.product?.subBrand?.name || "",
          "Product HSN Code": item.product?.product_hsn_code || "",
          RLP: item.price?.rlp_price || 0,
          "Bill Qty": item.billQty || 0,
          "Return Qty": item.returnQty || 0,
          "Gross Amount": item.grossAmt || 0,
          "Taxable Amount": item.taxableAmt || 0,
          CGST: item.totalCGST || 0,
          SGST: item.totalSGST || 0,
          IGST: item.totalIGST || 0,
          "Net Amount": item.netAmt || 0,
          "Base Point": basePoint,
          Remark: item.salesReturnRemark || "",
        });
      });
    });

    // Finalize the CSV stream when the cursor is finished
    cursor.on("end", () => {
      csvStream.end();
    });

    // Handle any errors during the database query
    cursor.on("error", (err) => {
      console.error("Error during report generation cursor:", err);
      csvStream.end();
      res.status(500).send("Error generating report");
    });
  } catch (error) {
    console.error("Error in generateSalesReturnReport:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { generateSalesReturnReport };
