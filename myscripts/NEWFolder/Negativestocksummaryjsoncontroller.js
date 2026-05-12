const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const StockLedger = require("../../models/stockLedger.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");

const TIMEZONE = "Asia/Kolkata";

/**
 * GET /api/v1/db-transaction/negative-stock-summary
 *
 * Query params:
 *   distributorId   – single distributor ObjectId
 *   distributorIds  – comma-separated list OR "all"
 *   startDate       – YYYY-MM-DD (optional)
 *   endDate         – YYYY-MM-DD (optional, defaults to today)
 */
const negativeStockSummaryJson = asyncHandler(async (req, res) => {
  const { distributorId, distributorIds, startDate, endDate } = req.query;

  /* ------------------------------------------------------------------ */
  /* DATE RANGE                                                         */
  /* ------------------------------------------------------------------ */
  const parsedStart = startDate
    ? moment.tz(startDate, TIMEZONE).startOf("day")
    : null;

  const parsedEnd = endDate
    ? moment.tz(endDate, TIMEZONE).endOf("day")
    : moment.tz(TIMEZONE).endOf("day");

  if (startDate && !parsedStart.isValid()) {
    return res.status(400).json({ error: true, message: `Invalid startDate: ${startDate}` });
  }

  const endOfDay = parsedEnd.toDate();

  const dateFilter = parsedStart
    ? { $gte: parsedStart.toDate(), $lte: endOfDay }
    : { $lte: endOfDay };

  /* ------------------------------------------------------------------ */
  /* FETCH DISTRIBUTORS                                                 */
  /* ------------------------------------------------------------------ */
  let distQuery = {};
  if (distributorIds && distributorIds !== "all") {
    distQuery._id = { $in: distributorIds.split(",").map((s) => s.trim()) };
  } else if (distributorId) {
    distQuery._id = distributorId;
  }

  const distributors = await Distributor.find(distQuery).select("_id dbCode name lean()");

  if (!distributors.length) {
    return res.status(404).json({ error: true, message: "No distributors found" });
  }

  /* ------------------------------------------------------------------ */
  /* BATCH FETCH ALL DATA                                               */
  /* ------------------------------------------------------------------ */
  const distributorIdsList = distributors.map(d => d._id);
  
  // Fetch all ledger entries in bulk
  const ledgerQuery = {
    distributorId: { $in: distributorIdsList },
    date: dateFilter
  };
  
  if (parsedStart) {
    ledgerQuery.date = dateFilter;
  }
  
  const allLedgerEntries = await StockLedger.find(ledgerQuery)
    .lean()
    .sort({ distributorId: 1, productId: 1, date: 1 });
  
  // Fetch all products in one query
  const allProductIds = [...new Set(allLedgerEntries.map(e => e.productId.toString()))];
  const allProducts = await Product.find({ _id: { $in: allProductIds } })
    .select("_id name product_code")
    .lean();
  
  const productMap = new Map(allProducts.map(p => [p._id.toString(), p]));
  
  // Fetch opening balances if startDate provided
  let openingBalances = new Map(); // key: "distributorId_productId"
  if (parsedStart) {
    const openingBalanceData = await StockLedger.aggregate([
      {
        $match: {
          distributorId: { $in: distributorIdsList },
          date: { $lt: parsedStart.toDate() }
        }
      },
      {
        $group: {
          _id: {
            distributorId: "$distributorId",
            productId: "$productId"
          },
          totalQty: { $sum: "$qtyChange" }
        }
      },
      {
        $match: { totalQty: { $ne: 0 } }
      }
    ]);
    
    for (const item of openingBalanceData) {
      const key = `${item._id.distributorId}_${item._id.productId}`;
      openingBalances.set(key, item.totalQty);
    }
  }
  
  // Group ledger entries by distributor and product
  const groupedData = new Map(); // key: "distributorId_productId"
  
  for (const entry of allLedgerEntries) {
    const key = `${entry.distributorId}_${entry.productId}`;
    if (!groupedData.has(key)) {
      groupedData.set(key, []);
    }
    groupedData.get(key).push(entry);
  }
  
  /* ------------------------------------------------------------------ */
  /* PROCESS ALL DATA IN MEMORY                                         */
  /* ------------------------------------------------------------------ */
  const results = [];
  
  // Create distributor map for quick lookup
  const distributorMap = new Map(distributors.map(d => [d._id.toString(), d]));
  
  for (const [key, entries] of groupedData.entries()) {
    const [distributorIdStr, productIdStr] = key.split("_");
    const distributor = distributorMap.get(distributorIdStr);
    const product = productMap.get(productIdStr);
    
    if (!distributor || !product) continue;
    
    // Get opening balance
    const openingKey = `${distributorIdStr}_${productIdStr}`;
    let runningStock = openingBalances.get(openingKey) || 0;
    
    // Group entries by date
    const entriesByDate = new Map();
    for (const entry of entries) {
      const dateKey = moment.tz(entry.date, TIMEZONE).format("YYYY-MM-DD");
      if (!entriesByDate.has(dateKey)) {
        entriesByDate.set(dateKey, []);
      }
      entriesByDate.get(dateKey).push(entry);
    }
    
    // Determine date range
    const firstEntryDate = entries[0] 
      ? moment.tz(entries[0].date, TIMEZONE)
      : (parsedStart || moment.tz(endOfDay, TIMEZONE));
    
    const iterStart = (parsedStart && parsedStart.isBefore(firstEntryDate))
      ? parsedStart.clone()
      : firstEntryDate.clone().startOf("day");
    
    const iterEnd = moment.tz(endOfDay, TIMEZONE);
    
    let cumulativeAdjustment = 0;
    const current = iterStart.clone();
    
    // Pre-calculate transaction type multipliers for faster processing
    while (current.isSameOrBefore(iterEnd, "day")) {
      const dateKey = current.format("YYYY-MM-DD");
      const dayEntries = entriesByDate.get(dateKey) || [];
      
      if (dayEntries.length === 0 && runningStock >= 0) {
        current.add(1, "day");
        continue;
      }
      
      // Calculate net change for the day efficiently
      let netChange = 0;
      for (const entry of dayEntries) {
        netChange += entry.qtyChange;
      }
      
      const closingStock = runningStock + netChange;
      
      if (closingStock < 0) {
        cumulativeAdjustment += Math.abs(closingStock);
        runningStock = 0;
      } else {
        runningStock = closingStock;
      }
      
      current.add(1, "day");
    }
    
    if (cumulativeAdjustment > 0) {
      results.push({
        distributorId: distributor._id,
        distributorCode: distributor.dbCode || "",
        distributorName: distributor.name || "",
        productId: product._id,
        productCode: product.product_code || "",
        productName: product.name || "",
        cumulativeAdjustment,
      });
    }
  }
  
  return res.status(200).json({
    total: results.length,
    data: results,
  });
});

module.exports = { negativeStockSummaryJson };