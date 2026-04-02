const Invoice = require("../../models/invoice.model");
const Bill = require("../../models/bill.model");
const TransactionModel = require("../../models/transaction.model");
const SalesReturn = require("../../models/salesReturn.model");
const PurchaseReturn = require("../../models/purchaseReturn.model");
const OutletApproved = require("../../models/outletApproved.model");
const Product = require("../../models/product.model");
const State = require("../../models/state.model");
const ExcelJS = require("exceljs");
const moment = require("moment");

/**
 * Helper function to safely get nested object values
 */
const getNestedValue = (obj, path, defaultValue = "") => {
  try {
    return (
      path.split(".").reduce((current, key) => current?.[key], obj) ||
      defaultValue
    );
  } catch (error) {
    return defaultValue;
  }
};

/**
 * Helper function to format date
 */
const formatDate = (date) => {
  if (!date) return "";
  return moment(date).format("DD-MM-YYYY");
};

/**
 * Helper function to format currency
 */
const formatCurrency = (value) => {
  return parseFloat(value || 0).toFixed(2);
};

const formatRoundOff = (value) => {
  return Math.round(parseFloat(value || 0));
};

/**
 * Helper function to calculate GST percentage
 */
// const calculateGSTPercentage = (taxableAmount, totalTax) => {
//   const taxable = parseFloat(taxableAmount || 0);
//   const tax = parseFloat(totalTax || 0);
//   return taxable > 0 ? ((tax / taxable) * 100).toFixed(2) : "0.00";
// };

const calculateGSTPercentage = (taxableAmount, totalTax) => {
  const taxable = parseFloat(taxableAmount || 0);

  // If taxable amount is greater than 2500, return 5%, else return 18%
  if (taxable <= 2500) {
    return "5.00";
  } else if (taxable > 2500) {
    return "18.00";
  } else {
    return "0.00";
  }
};

const calculateDiscount = (lineItem, type) => {
  let discountAmount = 0;
  let grossAmount = 0;

  if (type === "sales" || type === "salesReturn") {
    discountAmount =
      parseFloat(lineItem.schemeDisc || 0) +
      parseFloat(lineItem.distributorDisc || 0);
    grossAmount = parseFloat(lineItem.grossAmt || 0);
  } else if (type === "purchase" || type === "purchaseReturn") {
    discountAmount =
      parseFloat(lineItem.discountAmount || 0) +
      parseFloat(lineItem.specialDiscountAmount || 0);
    grossAmount = parseFloat(lineItem.grossAmount || lineItem.grossAmt || 0);
  }

  if (grossAmount <= 0) return "0.0000";
  return ((discountAmount / grossAmount) * 100).toFixed(4);
};

exports.generateTallyReport = async (req, res) => {
  try {
    const { distributorId, startDate, endDate, transactionTypes } = req.body;

    // Validate required fields
    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Prepare data containers
    const reportData = [];

    // Transaction types to include (default: all)
    const includeTypes = transactionTypes || [
      "sales",
      "salesReturn",
      "purchase",
      "purchaseReturn",
    ];

    // Fetch Sales data
    if (includeTypes.includes("sales")) {
      const bills = await Bill.find({
        distributorId,
        ...dateFilter,
      })
        .populate({
          path: "retailerId",
          select: "outletName gstin address1 pin",
          populate: {
            path: "stateId",
            select: "name",
          },
        })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .populate("lineItems.price", "mrp sellingPrice")
        .lean();

      for (const bill of bills) {
        for (let index = 0; index < bill.lineItems.length; index++) {
          const lineItem = bill.lineItems[index];

          const discount = calculateDiscount(lineItem, "sales");

          // const roundOff = index === 0 ? bill.roundOffAmount || 0 : 0;
          // Calculate GST percentage
          const taxableAmount = parseFloat(lineItem.grossAmt || 0);
          const totalTax =
            parseFloat(lineItem.totalCGST || 0) +
            parseFloat(lineItem.totalSGST || 0) +
            parseFloat(lineItem.totalIGST || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

          reportData.push({
            transactionType: "Sales",
            invoiceNo: bill.billNo || "",
            invoiceDate: formatDate(bill.createdAt),
            refDocNo: "RUPA DMS",
            refDocDate: formatDate(bill.updatedAt),
            partyName: getNestedValue(bill, "retailerId.outletName", ""),
            gstin: getNestedValue(bill, "retailerId.gstin", ""),
            state: getNestedValue(bill, "retailerId.stateId.name", ""),
            address: getNestedValue(bill, "retailerId.address1", ""),
            address2: "",
            address3: "",
            address4: "",
            pin: getNestedValue(bill, "retailerId.pin", ""),
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.billQty || 0,
            price: formatCurrency(
              lineItem.price?.sellingPrice ||
                lineItem.grossAmt / lineItem.billQty,
            ),
            grossAmount: formatCurrency(lineItem.grossAmt),
            cgst: formatCurrency(lineItem.totalCGST),
            sgst: formatCurrency(lineItem.totalSGST),
            igst: formatCurrency(lineItem.totalIGST),
            taxAmount: formatCurrency(totalTax),
            discount: formatCurrency(discount),
            taxableAmount: formatCurrency(lineItem.taxableAmt),
            netAmount: formatCurrency(lineItem.netAmt),
          });
        }
      }
    }

    // Fetch Sales Return data
    if (includeTypes.includes("salesReturn")) {
      const salesReturns = await SalesReturn.find({
        distributorId,
        ...dateFilter,
      })
        .populate({
          path: "retailerId",
          select: "outletName gstin address1 pin",
          populate: {
            path: "stateId",
            select: "name",
          },
        })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .populate("lineItems.price", "mrp sellingPrice")
        .lean();

      for (const salesReturn of salesReturns) {
        for (let index = 0; index < salesReturn.lineItems.length; index++) {
          const lineItem = salesReturn.lineItems[index];

          const discount = calculateDiscount(lineItem, "salesReturn");
          const roundOff = index === 0 ? salesReturn.roundOffAmount || 0 : 0;
          // Calculate GST percentage
          const taxableAmount = parseFloat(lineItem.grossAmt || 0);
          const totalTax =
            parseFloat(lineItem.totalCGST || 0) +
            parseFloat(lineItem.totalSGST || 0) +
            parseFloat(lineItem.totalIGST || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

          reportData.push({
            transactionType: "Sales Return",
            invoiceNo: salesReturn.salesReturnNo || "",
            invoiceDate: formatDate(salesReturn.createdAt),
            refDocNo: "RUPA DMS",
            refDocDate: formatDate(salesReturn.updatedAt),
            partyName: getNestedValue(salesReturn, "retailerId.outletName", ""),
            gstin: getNestedValue(salesReturn, "retailerId.gstin", ""),
            state: getNestedValue(salesReturn, "retailerId.stateId.name", ""),
            address: getNestedValue(salesReturn, "retailerId.address1", ""),
            address2: "",
            address3: "",
            address4: "",
            pin: getNestedValue(salesReturn, "retailerId.pin", ""),
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.returnQty || 0,
            price: formatCurrency(
              lineItem.price?.sellingPrice ||
                lineItem.grossAmt / lineItem.returnQty,
            ),
            grossAmount: formatCurrency(lineItem.grossAmt),
            cgst: formatCurrency(lineItem.totalCGST),
            sgst: formatCurrency(lineItem.totalSGST),
            igst: formatCurrency(lineItem.totalIGST),
            taxAmount: formatCurrency(totalTax),
            discount: formatCurrency(discount),
            taxableAmount: formatCurrency(lineItem.taxableAmt),
            netAmount: formatCurrency(lineItem.netAmt),
          });
        }
      }
    }

    // Fetch Purchase data
    if (includeTypes.includes("purchase")) {
      const invoices = await Invoice.find({
        distributorId,
        ...dateFilter,
      })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .lean();

      for (const invoice of invoices) {
        for (let index = 0; index < invoice.lineItems.length; index++) {
          const lineItem = invoice.lineItems[index];

          const discount = calculateDiscount(lineItem, "purchase");
          const roundOff = index === 0 ? invoice.roundOff || 0 : 0;
          // Calculate GST percentage
          const taxableAmount = parseFloat(lineItem.grossAmount || 0);
          const totalTax =
            parseFloat(lineItem.cgst || 0) +
            parseFloat(lineItem.sgst || 0) +
            parseFloat(lineItem.igst || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

          reportData.push({
            transactionType: "Purchase",
            invoiceNo: invoice.invoiceNo || "",
            invoiceDate: formatDate(invoice.date || invoice.createdAt),
            refDocNo: "RUPA DMS",
            refDocDate: formatDate(invoice.date || invoice.updatedAt),
            partyName: "RUPA & COMPANY LIMITED",
            gstin: invoice.supplierGSTIN || "",
            state: invoice.supplierState || "",
            address: invoice.supplieraddress1 || "",
            address2: "",
            address3: "",
            address4: "",
            pin: "",
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.receivedQty || lineItem.qty || 0,
            price: formatCurrency(
              lineItem.mrp || lineItem.taxableAmount / lineItem.qty,
            ),
            grossAmount: formatCurrency(lineItem.grossAmount),
            cgst: formatCurrency(lineItem.cgst),
            sgst: formatCurrency(lineItem.sgst),
            igst: formatCurrency(lineItem.igst),
            taxAmount: formatCurrency(totalTax),
            discount: formatCurrency(discount),
            taxableAmount: formatCurrency(lineItem.taxableAmount),
            netAmount: formatCurrency(lineItem.netAmount),
          });
        }
      }
    }

    // Fetch Purchase Return data
    if (includeTypes.includes("purchaseReturn")) {
      const purchaseReturns = await PurchaseReturn.find({
        distributorId,
        ...dateFilter,
      })
        .populate("lineItems.product", "name product_code product_hsn_code")
        .populate("invoiceId", "invoiceNo supplierName")
        .lean();

      for (const purchaseReturn of purchaseReturns) {
        for (let index = 0; index < purchaseReturn.lineItems.length; index++) {
          const lineItem = purchaseReturn.lineItems[index];

          const discount = calculateDiscount(lineItem, "purchaseReturn");
          const roundOff = index === 0 ? purchaseReturn.roundOff || 0 : 0;
          // Calculate GST percentage
          const taxableAmount = parseFloat(lineItem.grossAmt || 0);
          const totalTax =
            parseFloat(lineItem.cgst || 0) +
            parseFloat(lineItem.sgst || 0) +
            parseFloat(lineItem.igst || 0);
          const gstPercentage = calculateGSTPercentage(taxableAmount, totalTax);

          reportData.push({
            transactionType: "Purchase Return",
            invoiceNo: purchaseReturn.code || "",
            invoiceDate: formatDate(purchaseReturn.createdAt),
            refDocNo: "RUPA DMS",
            refDocDate: formatDate(purchaseReturn.updatedAt),
            partyName: "RUPA & COMPANY LIMITED",
            gstin: "",
            state: "",
            address: "",
            address2: "",
            address3: "",
            address4: "",
            pin: "",
            productName: getNestedValue(lineItem, "product.product_code", ""),
            description: getNestedValue(lineItem, "product.name", ""), // Full name of product
            hsnNo: getNestedValue(lineItem, "product.product_hsn_code", ""),
            uom: lineItem.uom || "pcs",
            gst: gstPercentage,
            qty: lineItem.returnQty || 0,
            price: formatCurrency(
              lineItem.mrp || lineItem.grossAmt / lineItem.returnQty,
            ),
            grossAmount: formatCurrency(lineItem.grossAmt),
            cgst: formatCurrency(lineItem.cgst),
            sgst: formatCurrency(lineItem.sgst),
            igst: formatCurrency(lineItem.igst),
            taxAmount: formatCurrency(totalTax),
            discount: formatCurrency(discount),
            taxableAmount: formatCurrency(lineItem.taxableAmt),
            netAmount: formatCurrency(lineItem.netAmt),
          });
        }
      }
    }

    // Generate Excel file
    const filePath = await generateExcelReport(reportData, distributorId);

    // Send file
    res.download(
      filePath,
      `Tally_Report_${moment().format("YYYYMMDD_HHmmss")}.xlsx`,
      (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          return res.status(500).json({
            success: false,
            message: "Error downloading file",
          });
        }

        // Clean up file after sending
        const fs = require("fs");
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error("Error deleting temp file:", unlinkErr);
        });
      },
    );
  } catch (error) {
    console.error("Error generating Tally report:", error);
    res.status(500).json({
      success: false,
      message: "Error generating Tally report",
      error: error.message,
    });
  }
};

/**
 * Generate Excel file from report data
 */
const generateExcelReport = async (reportData, distributorId) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Tally Master Sheet");

  // Define columns based on the sample format
  worksheet.columns = [
    { header: "Transaction Type", key: "transactionType", width: 18 },
    { header: "Invoice No", key: "invoiceNo", width: 15 },
    { header: "Invoice Date", key: "invoiceDate", width: 20 },
    { header: "Ref Doc No", key: "refDocNo", width: 15 },
    { header: "Ref Date", key: "refDocDate", width: 20 },
    { header: "Party Name", key: "partyName", width: 30 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "STATE CODE", key: "state", width: 15 },
    { header: "Address1", key: "address", width: 30 },
    { header: "Address2", key: "address2", width: 30 },
    { header: "Address3", key: "address3", width: 30 },
    { header: "Address4", key: "address4", width: 30 },
    { header: "Pin Code", key: "pin", width: 10 },
    { header: "Item Name", key: "productName", width: 25 },
    { header: "Product Description", key: "description", width: 30 },
    { header: "HSN No", key: "hsnNo", width: 12 },
    { header: "Unit", key: "uom", width: 12 },
    { header: "GST Per", key: "gst", width: 10 },
    { header: "Qty", key: "qty", width: 10 },
    { header: "Unit Price", key: "price", width: 12 },
    { header: "Item Value", key: "grossAmount", width: 15 },
    { header: "Discount", key: "discount", width: 12 },
    { header: "Taxable Amount", key: "taxableAmount", width: 15 },
    { header: "CGST", key: "cgst", width: 12 },
    { header: "SGST", key: "sgst", width: 12 },
    { header: "IGST", key: "igst", width: 12 },
    { header: "Tax Amount", key: "taxAmount", width: 12 },
    { header: "Net Amount", key: "netAmount", width: 15 },
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, size: 11, name: "Arial" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 20;

  // Add data rows
  reportData.forEach((data) => {
    worksheet.addRow(data);
  });

  // Apply formatting to all data rows
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.font = { size: 10, name: "Arial" };
      row.alignment = { vertical: "middle" };

      // Format numeric columns
      [
        "qty",
        "price",
        "grossAmount",
        "taxAmount",
        "cgst",
        "sgst",
        "igst",
        "netAmount",
        "taxableAmount",
      ].forEach((key) => {
        const cell = row.getCell(key);
        cell.numFmt = "#,##0.00";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      });

      // Format GST percentage column
      const gstCell = row.getCell("gst");
      gstCell.numFmt = "0.00";
      gstCell.alignment = { vertical: "middle", horizontal: "right" };

      // Center align specific columns
      ["transactionType", "uom"].forEach((key) => {
        const cell = row.getCell(key);
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
    }
  });

  // Add borders to all cells
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  // Auto-filter
  worksheet.autoFilter = {
    from: "A1",
    to: `Z1`,
  };

  // Freeze header row
  worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  // Save file
  const fs = require("fs");
  const path = require("path");
  const tempDir = path.join(__dirname, "../../temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(
    tempDir,
    `Tally_Report_${distributorId}_${Date.now()}.xlsx`,
  );
  await workbook.xlsx.writeFile(filePath);

  return filePath;
};

/**
 * Get Tally Report Summary
 * @route GET /api/tally/summary
 * @access Private
 */
exports.getTallyReportSummary = async (req, res) => {
  try {
    const { distributorId, startDate, endDate } = req.query;

    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get counts and totals
    const [salesCount, salesReturnCount, purchaseCount, purchaseReturnCount] =
      await Promise.all([
        Bill.countDocuments({ distributorId, ...dateFilter }),
        SalesReturn.countDocuments({ distributorId, ...dateFilter }),
        Invoice.countDocuments({ distributorId, ...dateFilter }),
        PurchaseReturn.countDocuments({ distributorId, ...dateFilter }),
      ]);

    // Get total amounts
    const [salesTotal, salesReturnTotal, purchaseTotal, purchaseReturnTotal] =
      await Promise.all([
        Bill.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$netAmount" } } },
        ]),
        SalesReturn.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$netAmount" } } },
        ]),
        Invoice.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$totalInvoiceAmount" } } },
        ]),
        PurchaseReturn.aggregate([
          { $match: { distributorId: distributorId, ...dateFilter } },
          { $group: { _id: null, total: { $sum: "$netAmount" } } },
        ]),
      ]);

    res.status(200).json({
      success: true,
      data: {
        sales: {
          count: salesCount,
          total: salesTotal[0]?.total || 0,
        },
        salesReturn: {
          count: salesReturnCount,
          total: salesReturnTotal[0]?.total || 0,
        },
        purchase: {
          count: purchaseCount,
          total: purchaseTotal[0]?.total || 0,
        },
        purchaseReturn: {
          count: purchaseReturnCount,
          total: purchaseReturnTotal[0]?.total || 0,
        },
        netSales:
          (salesTotal[0]?.total || 0) - (salesReturnTotal[0]?.total || 0),
        netPurchase:
          (purchaseTotal[0]?.total || 0) - (purchaseReturnTotal[0]?.total || 0),
      },
    });
  } catch (error) {
    console.error("Error getting Tally report summary:", error);
    res.status(500).json({
      success: false,
      message: "Error getting report summary",
      error: error.message,
    });
  }
};

/**
 * Get Inventory Transactions for Tally
 * @route GET /api/tally/inventory-transactions
 * @access Private
 */
exports.getInventoryTransactions = async (req, res) => {
  try {
    const { distributorId, startDate, endDate, productId, transactionType } =
      req.query;

    if (!distributorId) {
      return res.status(400).json({
        success: false,
        message: "Distributor ID is required",
      });
    }

    const filter = { distributorId };

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    if (productId) {
      filter.productId = productId;
    }

    if (transactionType) {
      filter.transactionType = transactionType;
    }

    const transactions = await TransactionModel.find(filter)
      .populate("productId", "name product_code product_hsn_code")
      .sort({ date: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Error getting inventory transactions:", error);
    res.status(500).json({
      success: false,
      message: "Error getting inventory transactions",
      error: error.message,
    });
  }
};

module.exports = exports;
