const asyncHandler = require("express-async-handler");
const axios = require("axios");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Plant = require("../../models/plant.model");
const Invoice = require("../../models/invoice.model");
const GrnLOG = require("../../models/grnLogSchema");
const { releaseLock, acquireLock } = require("../../models/lock.model");
const notificationQueue = require("../../queues/notificationQueue");

// Utility function to parse SAP date format (YYYYMMDD)
const parseSapDate = (sapDate) => {
  if (!sapDate || sapDate.length !== 8) return new Date();
  const year = sapDate.substring(0, 4);
  const month = sapDate.substring(4, 6);
  const day = sapDate.substring(6, 8);
  return new Date(`${year}-${month}-${day}`);
};

// Utility function to format date to DD.MM.YYYY
function formatDateToDDMMYYYY(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

const processGrnImport = async (item) => {
  try {
    const Invoice_Number = item?.VbelnBill;
    const Invoice_Date = parseSapDate(item?.Fkdat);

    const distributorCode = item?.Kunnr;
    if (!distributorCode) {
      const errorLog = `Distributor code is missing for GRN with Invoice Number: ${Invoice_Number}`;
      console.log("GrnLOG ErrorLog:", errorLog);
      await GrnLOG.findOneAndUpdate(
        { Grn_Id: Invoice_Number },
        {
          GrnStatus: "Import_Failed",
          ErrorLog: errorLog,
          GrnData: item,
          SearchKey: JSON.stringify(item),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return null;
    }
    const distributor = await Distributor.findOne({ dbCode: distributorCode });
    if (!distributor) {
      const errorLog = `Distributor not found for code: ${distributorCode} for Invoice Number: ${Invoice_Number}`;
      console.log("GrnLOG ErrorLog:", errorLog);
      await GrnLOG.findOneAndUpdate(
        { Grn_Id: Invoice_Number },
        {
          GrnStatus: "Import_Failed",
          ErrorLog: errorLog,
          GrnData: item,
          SearchKey: JSON.stringify(item),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return null;
    }
    const distributorId = distributor._id;
    const orderItems = item?.orders || [];
    if (!orderItems.length) {
      const errorLog = `No order items found for GRN with Invoice Number: ${Invoice_Number}`;
      console.log("GrnLOG ErrorLog:", errorLog);
      await GrnLOG.findOneAndUpdate(
        { Grn_Id: Invoice_Number },
        {
          GrnStatus: "Import_Failed",
          ErrorLog: errorLog,
          GrnData: item,
          SearchKey: JSON.stringify(item),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return null;
    }

    // Helper functions
    // OLD CODE:
    // const getQty = (orderItem) => parseFloat(orderItem?.Fklmg || 0);
    
    // NEW CODE: Round quantity to nearest integer and log if adjusted
    const getQty = (orderItem) => {
      const rawQty = parseFloat(orderItem?.Fklmg || 0);
      const roundedQty = Math.round(rawQty);
      
      // Log quantity adjustments for audit trail
      if (rawQty !== roundedQty) {
        console.log(`[QTY ADJUSTMENT] Product: ${orderItem?.Matnr}, Original: ${rawQty}, Rounded: ${roundedQty}, Difference: ${(roundedQty - rawQty).toFixed(3)}`);
      }
      
      return roundedQty;
    };
    
    const getGrossAmount = (orderItem) => parseFloat(orderItem?.Gvalu || 0);
    const getMrp = (orderItem) => {
      const qty = getQty(orderItem);
      const amt = getGrossAmount(orderItem) / (qty || 1);
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };

    const getTradeDiscount = (orderItem) => {
      let amt =
        parseFloat(orderItem?.Ztrd || 0) + parseFloat(orderItem?.Ztrp || 0);
      amt = Math.abs(amt); // Ensure positive value
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };

    const getSpecialDiscount = (orderItem) => {
      let amt =
        parseFloat(orderItem?.Zccd || 0) +
        parseFloat(orderItem?.Zqtd || 0) +
        parseFloat(orderItem?.Zccp || 0);
      amt = Math.abs(amt); // Ensure positive value
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };

    const getTaxableAmount = (orderItem) => {
      const amt =
        getGrossAmount(orderItem) -
        getTradeDiscount(orderItem) -
        getSpecialDiscount(orderItem);
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };
    const getCGST = (orderItem) => {
      const gstType = orderItem?.Vehical;
      if (gstType === "IGST") return 0;
      const amt = parseFloat(orderItem?.Tvalu || 0) / 2;
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };
    const getSGST = (orderItem) => {
      const gstType = orderItem?.Vehical;
      if (gstType === "IGST") return 0;
      const amt = parseFloat(orderItem?.Tvalu || 0) / 2;
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };
    const getIGST = (orderItem) => {
      const gstType = orderItem?.Vehical;
      if (gstType === "IGST") {
        const amt = parseFloat(orderItem?.Tvalu || 0);
        return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
      }
      return 0;
    };

    const getNetAmount = (orderItem) => {
      const amt =
        getTaxableAmount(orderItem) +
        getCGST(orderItem) +
        getSGST(orderItem) +
        getIGST(orderItem);
      return amt > 0 ? parseFloat(amt.toFixed(2)) : 0;
    };

    function convertSapDate(sapDate) {
      if (!sapDate || sapDate.length !== 8) return null;
      return `${sapDate.slice(0, 4)}-${sapDate.slice(4, 6)}-${sapDate.slice(
        6,
        8
      )}`;
    }

    // Prepare Line Items
    let lineItems = [];
    let skippedItems = [];
    let totalBasePoints = 0;

    for (const orderItem of orderItems) {
      const productCode = orderItem?.Matnr;
      if (!productCode) {
        skippedItems.push(orderItem);
        continue;
      }
      const product = await Product.findOne({ product_code: productCode });
      if (!product) {
        skippedItems.push(orderItem);
        continue;
      }
      const productId = product._id;

      const plantCode = orderItem?.Werks;
      if (!plantCode) {
        skippedItems.push(orderItem);
        continue;
      }
      const plant = await Plant.findOne({ plantCode });
      if (!plant) {
        skippedItems.push(orderItem);
        continue;
      }
      const plantId = plant._id;

      totalBasePoints += getQty(orderItem) * Number(product.base_point || 0);

      lineItems.push({
        product: productId,
        plant: plantId,
        goodsType: getGrossAmount(orderItem) > 0 ? "billed" : "free",
        mrp: getMrp(orderItem),
        qty: getQty(orderItem), // Uses rounded quantity
        receivedQty: getQty(orderItem), // Uses rounded quantity
        usedBasePoint: Number(product.base_point || 0),
        grossAmount: getGrossAmount(orderItem),
        discountAmount: getTradeDiscount(orderItem),
        specialDiscountAmount: getSpecialDiscount(orderItem),
        taxableAmount: getTaxableAmount(orderItem),
        cgst: getCGST(orderItem),
        sgst: getSGST(orderItem),
        igst: getIGST(orderItem),
        netAmount: getNetAmount(orderItem),
        shortageQty: 0,
        shortageUom: "pcs",
        damageQty: 0,
        damageUom: "pcs",
        poNumber: orderItem?.VbelnSo ? orderItem?.VbelnSo : null,
      });
    }
    if (skippedItems.length > 0) {
      const errorLog = `Skipped ${skippedItems.length} items due to missing product or plant information in GRN with Invoice Number: ${Invoice_Number}`;
      console.log("GrnLOG ErrorLog:", errorLog);
      await GrnLOG.findOneAndUpdate(
        { Grn_Id: Invoice_Number },
        {
          GrnStatus: "Import_Failed",
          ErrorLog: errorLog,
          GrnData: { item, skippedItems },
          SearchKey: JSON.stringify({ item, skippedItems }),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return null;
    }

    // Invoice calculations
    const sum = (arr, key) =>
      arr.reduce((acc, item) => acc + (item[key] || 0), 0);
    const invoiceAmount = sum(lineItems, "netAmount");
    const roundOff = parseFloat(
      (Math.round(invoiceAmount) - invoiceAmount).toFixed(2)
    );
    const totalInvoiceAmount = parseFloat(
      (invoiceAmount + roundOff).toFixed(2)
    ); // Prepare Invoice Object
    const invoiceObj = {
      distributorId,
      invoiceNo: Invoice_Number,
      date: Invoice_Date,
      // poNumber: SO_Number,
      // poDate: SO_Date,
      status: "In-Transit",
      lineItems,
      grossAmount: sum(lineItems, "grossAmount"),
      tradeDiscount: sum(lineItems, "discountAmount"),
      specialDiscountAmount: sum(lineItems, "specialDiscountAmount"),
      taxableAmount: sum(lineItems, "taxableAmount"),
      cgst: sum(lineItems, "cgst"),
      sgst: sum(lineItems, "sgst"),
      igst: sum(lineItems, "igst"),
      invoiceAmount,
      roundOff,
      totalInvoiceAmount,
      totalBasePoints,
    };

    // console.log({
    //   ...invoiceObj,
    //   lineItems: null,
    // });

    // create invoice
    const invoice = await Invoice.create(invoiceObj);
    console.log(
      `Invoice created successfully for Invoice Number: ${Invoice_Number}, Invoice ID: ${invoice._id}`
    );

    // Log the GRN import in GrnLOG (success, so no ErrorLog)
    await GrnLOG.findOneAndUpdate(
      { Grn_Id: Invoice_Number },
      {
        GrnData: item,
        SearchKey: JSON.stringify(item),
        GrnStatus: "Import_Success",
        invoiceId: invoice._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Link log to invoice
    invoice.GRNLogId = invoice._id;
    invoice.GRNFKDATE = convertSapDate(item?.Fkdat);
    await invoice.save();

    return invoice;
  } catch (error) {
    const errorLog = error.message || "Unknown error occurred during import";
    console.log("GrnLOG ErrorLog:", errorLog);
    await GrnLOG.findOneAndUpdate(
      { Grn_Id: item?.VbelnBill },
      {
        GrnStatus: "Import_Failed",
        ErrorLog: errorLog,
        GrnData: item,
        SearchKey: JSON.stringify(item),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
};

const fetchSapGrnData = asyncHandler(async (req, res) => {
  console.log("🔒 [syncFetchSAPGRN] Attempting to acquire lock...");
  if (!(await acquireLock("syncFetchSAPGRN"))) {
    console.error("⛔ [syncFetchSAPGRN] Lock acquisition failed.");
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }
  console.log("✅ [syncFetchSAPGRN] Lock acquired.");

  try {
    let startDate = req.query.startDate;
    let endDate = req.query.endDate;
    let neededDbCodes = req.query.neededDbCodes?.split(",") || [];

    if (!startDate) {
      const d = new Date();
      d.setDate(d.getDate() - 120);
      startDate = formatDateToDDMMYYYY(d);
    }

    if (!endDate) {
      endDate = formatDateToDDMMYYYY(new Date());
    }

    if (!neededDbCodes || neededDbCodes.length === 0) {
      // Get all active distributor codes
      const distributors = await Distributor.find({ status: true })
        .select("dbCode")
        .lean();
      neededDbCodes = distributors.map((d) => d.dbCode);
    }

    console.log("Needed Distributor Codes:", neededDbCodes);

    if (!startDate || !endDate) {
      res.status(400);
      throw new Error("Missing required query parameters: startDate, endDate");
    }

    // Collect all results for all distributors
    let allResults = [];
    let allResultsRupa = [];
    let msSuccessCount = 0;
    let msFailureCount = 0;
    let rupaSuccessCount = 0;
    let rupaFailureCount = 0;

    // Track GRN imports per distributor for notifications
    const distributorGrnCounts = new Map();

    // for brand ms
    // Use Promise.all to fetch in parallel (or for...of for sequential)
    for (const distributorCode of neededDbCodes) {
      try {
        const response = await axios.get(
          `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_PSSPL_SALES_ODATA1_MS_SRV/BillHeaderSet(StartDate='${startDate}',EndDate='${endDate}',Kunnr='${distributorCode}')/HeaderItem?$format=json`
        );

        console.log({
          response: response?.data,
          distributorCode,
          url: `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_PSSPL_SALES_ODATA1_MS_SRV/BillHeaderSet(StartDate='${startDate}',EndDate='${endDate}',Kunnr='${distributorCode}')/HeaderItem?$format=json`,
        });

        const data = response?.data?.d?.results;

        if (!data || data.length === 0) {
          // No data for this distributor, skip
          continue;
        } // Group and process by Invoice Number instead of PO Number
        const commonFields = [
          "Kunnr", // Distributor Code
          "VbelnBill", // Invoice Number
          "Fkdat", // Invoice Date
        ];

        const grouped = data.reduce((acc, item) => {
          const vbelnBill = item.VbelnBill.toString();
          if (!acc[vbelnBill]) {
            acc[vbelnBill] = [];
          }
          acc[vbelnBill].push(item);
          return acc;
        }, {});

        let result = Object.entries(grouped).map(([VbelnBill, orders]) => {
          const firstOrder = orders[0];
          const commonData = {};
          commonFields.forEach((field) => {
            commonData[field] = firstOrder[field];
          });
          return {
            ...commonData,
            orders: orders.map((order) => ({ ...order })),
          };
        });

        // filter already imported GRNs by Invoice Number
        result = result.filter((item) => item.VbelnBill);

        // Filter out items that already exist in GrnLOG
        const filtered = await Promise.all(
          result.map(async (item) => {
            const Grn_Id = item?.VbelnBill;
            const existingGrn = await GrnLOG.findOne({
              Grn_Id,
              GrnStatus: "Import_Success",
            });
            return !existingGrn;
          })
        );

        const finalResult = result.filter((_, idx) => filtered[idx]) || [];

        // ✅ FIXED: Process sequentially instead of parallel
        for (const item of finalResult) {
          try {
            const invoiceResult = await processGrnImport(item);
            if (invoiceResult) {
              msSuccessCount++;
              // Track GRN count per distributor
              const distId = invoiceResult.distributorId.toString();
              distributorGrnCounts.set(
                distId,
                (distributorGrnCounts.get(distId) || 0) + 1
              );
            } else {
              msFailureCount++;
            }
          } catch (error) {
            console.error(
              `Failed to process MS invoice ${item.VbelnBill || item.Grn_Id}:`,
              error.message
            );
            msFailureCount++;
          }
        }

        allResults.push(...finalResult);
      } catch (err) {
        // Log error for this distributor, but continue with others
        console.error(
          `Error fetching data for distributor ${distributorCode}:`,
          err.message
        );
      }
    }

    // for brand rupa
    // Use Promise.all to fetch in parallel (or for...of for sequential)
    for (const distributorCode of neededDbCodes) {
      try {
        // http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_PSSPL_SALES_ODATA1_SRV/BillHeaderSet(StartDate='01.04.2025',EndDate='03.05.2025',Kunnr='DCAL1001')/HeaderItem?$format=json

        const response = await axios.get(
          `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_PSSPL_SALES_ODATA1_SRV/BillHeaderSet(StartDate='${startDate}',EndDate='${endDate}',Kunnr='${distributorCode}')/HeaderItem?$format=json`
        );

        console.log({
          response: response?.data,
          distributorCode,
          url: `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_PSSPL_SALES_ODATA1_SRV/BillHeaderSet(StartDate='${startDate}',EndDate='${endDate}',Kunnr='${distributorCode}')/HeaderItem?$format=json`,
        });

        const data = response?.data?.d?.results;
     
        if (!data || data.length === 0) {
          // No data for this distributor, skip
          continue;
        } // Group and process by Invoice Number instead of PO Number
        const commonFields = [
          "Kunnr", // Distributor Code
          "VbelnBill", // Invoice Number
          "Fkdat", // Invoice Date
        ];

        const grouped = data.reduce((acc, item) => {
          const vbelnBill = item.VbelnBill.toString();
          if (!acc[vbelnBill]) {
            acc[vbelnBill] = [];
          }
          acc[vbelnBill].push(item);
          return acc;
        }, {});
        let result = Object.entries(grouped).map(([VbelnBill, orders]) => {
          const firstOrder = orders[0];
          const commonData = {};
          commonFields.forEach((field) => {
            commonData[field] = firstOrder[field];
          });

          return {
            ...commonData,
            orders: orders.map((order) => ({ ...order })),
          };
        });

        // filter already imported GRNs by Invoice Number
        result = result.filter((item) => item.VbelnBill);

        // Filter out items that already exist in GrnLOG
        const filtered = await Promise.all(
          result.map(async (item) => {
            const Grn_Id = item?.VbelnBill;
            const existingGrn = await GrnLOG.findOne({
              Grn_Id,
              GrnStatus: "Import_Success",
            });
            return !existingGrn;
          })
        );

        const finalResult = result.filter((_, idx) => filtered[idx]) || [];

        // ✅ FIXED: Process sequentially instead of parallel
        for (const item of finalResult) {
          try {
            const invoiceResult = await processGrnImport(item);
            if (invoiceResult) {
              rupaSuccessCount++;
              // Track GRN count per distributor
              const distId = invoiceResult.distributorId.toString();
              distributorGrnCounts.set(
                distId,
                (distributorGrnCounts.get(distId) || 0) + 1
              );
            } else {
              rupaFailureCount++;
            }
          } catch (error) {
            console.error(
              `Failed to process RUPA invoice ${
                item.VbelnBill || item.Grn_Id
              }:`,
              error.message
            );
            rupaFailureCount++;
          }
        }

        allResultsRupa.push(...finalResult);
      } catch (err) {
        // Log error for this distributor, but continue with others
        console.error(
          `Error fetching data for distributor ${distributorCode}:`,
          err.message
        );
      }
    }

    console.log(
      `GRN Processing completed. MS - Success: ${msSuccessCount}, Failed: ${msFailureCount}`
    );
    console.log(
      `GRN Processing completed. RUPA - Success: ${rupaSuccessCount}, Failed: ${rupaFailureCount}`
    );

    // Send notifications to distributors about their GRN imports
    for (const [distributorId, grnCount] of distributorGrnCounts.entries()) {
      const message = `Successfully fetched ${grnCount} GRN(s) into your account`;
      
      await notificationQueue.add("grnImport", {
        type: "GRN",
        data: {
          message,
          title: "New GRN Entry",
          grnCount,
        },
        userId: distributorId,
        userType: "Distributor",
      });
    }

    res.status(200).json({
      status: 200,
      data: {
        MS: allResults,
        RUPA: allResultsRupa,
      },
      summary: {
        MS: { successCount: msSuccessCount, failureCount: msFailureCount },
        RUPA: {
          successCount: rupaSuccessCount,
          failureCount: rupaFailureCount,
        },
      },
      message: "GRN data fetched & processed successfully.",
    });
  } catch (error) {
    res.status(500);
    throw error;
  } finally {
    await releaseLock("syncFetchSAPGRN");
    console.log("🔓 [syncFetchSAPGRN] Lock released.");
  }
});

module.exports = { fetchSapGrnData };