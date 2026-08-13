const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const StockLedger = require("../../models/stockLedger.model");
const Distributor = require("../../models/distributor.model");
const Brand = require("../../models/brand.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");

const dbTransactionStockLedgerReport = asyncHandler(async (req, res) => {
  try {
    const { distributorId, distributorIds, brandIds, startDate, endDate } =
      req.query;

    if (!startDate || !endDate) {
      res.status(400);
      throw new Error("startDate and endDate are required");
    }

    const TIMEZONE = "Asia/Kolkata";

    // Parse and validate dates
    const parsedStartDate = moment.tz(startDate, TIMEZONE);
    const parsedEndDate = moment.tz(endDate, TIMEZONE);

    if (!parsedStartDate.isValid()) {
      res.status(400);
      throw new Error(`Invalid startDate format: ${startDate}`);
    }

    if (!parsedEndDate.isValid()) {
      res.status(400);
      throw new Error(`Invalid endDate format: ${endDate}`);
    }

    const startOfDay = parsedStartDate.startOf("day").toDate();
    const endOfDay = parsedEndDate.endOf("day").toDate();

    /* ------------------------------------------------------------ */
    /* FETCH DISTRIBUTORS                                           */
    /* ------------------------------------------------------------ */

    let distributorQuery = {};

    if (distributorIds && distributorIds !== "all") {
      distributorQuery._id = { $in: distributorIds.split(",") };
    }

    if (distributorId) {
      distributorQuery._id = distributorId;
    }

    const distributors = await Distributor.find(distributorQuery).populate(
      "stateId",
      "name",
    );

    if (!distributors.length) {
      res.status(404);
      throw new Error("No distributors found");
    }

    /* ------------------------------------------------------------ */
    /* CSV SETUP                                                    */
    /* ------------------------------------------------------------ */

    const headers = [
      "Date",
      "Distributor Code",
      "Distributor Name",
      "State",
      "Item Code",
      "Item Desc",
      "Product Type",
      "Category",
      "Segment",
      "Brand",
      "Opening Stock Balance",
      "DB Opening Stock (+)",
      "Opening Stock Price (Basic)",
      "Primary Purchase Stock (+)",
      "Primary Purchase Price (Basic)",
      "Stock Adjustment (+-)",
      "Secondary Sales Stock (-)",
      "Secondary Sales Price (Basic)",
      "Secondary Sales Return (+)",
      "Secondary Sales Return Price (Basic)",
      "Primary Purchase Return (-)",
      "Primary Purchase Return Price (Basic)",
      "Closing Stock",
    ];

    const fileName = `stock-ledger-${moment()
      .tz(TIMEZONE)
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({ headers });
    csvStream.pipe(res);

    /* ------------------------------------------------------------ */
    /* MAIN LOOP - PROCESS EACH DISTRIBUTOR                        */
    /* ------------------------------------------------------------ */

    for (const distributor of distributors) {
      const distributorIdObj = distributor._id;

      /* ---------- FIND ALL PRODUCTS WITH LEDGER ENTRIES --------- */

      const productsInRange = await StockLedger.distinct("productId", {
        distributorId: distributorIdObj,
        date: { $gte: startOfDay, $lte: endOfDay },
      });

      const productsWithOpeningStock = await StockLedger.aggregate([
        {
          $match: {
            distributorId: distributorIdObj,
            date: { $lt: startOfDay },
          },
        },
        {
          $group: {
            _id: "$productId",
            totalQty: { $sum: "$qtyChange" },
          },
        },
        {
          $match: {
            totalQty: { $gt: 0 },
          },
        },
      ]);

      const productIdsWithStock = productsWithOpeningStock.map((p) => p._id);

      const allProductIds = [
        ...new Set([...productsInRange, ...productIdsWithStock]),
      ];

      if (!allProductIds.length) continue;

      // Fetch product details (now including cat_id and subBrand for Category/Segment)
      const products = await Product.find({
        _id: { $in: allProductIds },
        ...(brandIds && brandIds !== "all"
          ? { brand: { $in: brandIds.split(",").map((id) => id.trim()) } }
          : {}),
      })
        .select("name product_code base_point brand cat_id subBrand product_type")
        .populate("brand", "name")
        .populate("cat_id", "name")
        .populate("subBrand", "name");

      /* ---------- PROCESS EACH PRODUCT -------------------------- */

      for (const product of products) {
        const productIdObj = product._id;

        // Fetch the latest active price for this product ("Basic" = rlp_price)
        const priceDoc = await Price.findOne({
          productId: productIdObj,
          status: true,
        }).sort({ effective_date: -1, createdAt: -1 });

        const basicPrice = priceDoc?.rlp_price
          ? parseFloat(priceDoc.rlp_price) || 0
          : 0;

        // Fetch all ledger entries for this product in date range
        const ledgerEntries = await StockLedger.find({
          distributorId: distributorIdObj,
          productId: productIdObj,
          date: { $gte: startOfDay, $lte: endOfDay },
        }).sort({ date: 1 });

        // Get opening balance (last entry before startDate)
        const openingAgg = await StockLedger.aggregate([
          {
            $match: {
              distributorId: distributorIdObj,
              productId: productIdObj,
              date: { $lt: startOfDay },
            },
          },
          {
            $group: {
              _id: null,
              totalQty: { $sum: "$qtyChange" },
              totalPoints: { $sum: "$pointChange" },
            },
          },
        ]);

        const initialOpeningStock = openingAgg[0]?.totalQty || 0;
        const initialOpeningPoints = openingAgg[0]?.totalPoints || 0;

        // Skip if no opening stock and no transactions in range
        if (initialOpeningStock === 0 && !ledgerEntries.length) {
          continue;
        }

        /* ---------- GROUP ENTRIES BY DATE ----------------------- */

        const entriesByDate = {};

        ledgerEntries.forEach((entry) => {
          const dateKey = moment.tz(entry.date, TIMEZONE).format("YYYY-MM-DD");

          if (!entriesByDate[dateKey]) {
            entriesByDate[dateKey] = [];
          }

          entriesByDate[dateKey].push(entry);
        });

        /* ---------- GENERATE DAILY ROWS ------------------------- */

        let runningOpeningStock = initialOpeningStock;
        let runningOpeningPoints = initialOpeningPoints;

        const currentDate = moment.tz(startOfDay, TIMEZONE);
        const endMoment = moment.tz(endOfDay, TIMEZONE);

        while (currentDate.isSameOrBefore(endMoment, "day")) {
          const dateKey = currentDate.format("YYYY-MM-DD");
          const dayEntries = entriesByDate[dateKey] || [];

          // Skip days with no transactions and zero opening balance
          if (dayEntries.length === 0 && runningOpeningStock === 0) {
            currentDate.add(1, "day");
            continue;
          }

          // Aggregate transactions by type
          let dbOpeningStock = 0;
          let primaryPurchaseStock = 0;
          let stockAdjustment = 0;
          let secondarySalesStock = 0;
          let secondarySalesReturn = 0;
          let primaryPurchaseReturn = 0;
          let totalPointsForDay = 0;

          dayEntries.forEach((entry) => {
            const qty = entry.qtyChange;
            const points = entry.pointChange;

            totalPointsForDay += points;

            switch (entry.transactionType) {
              case "openingstock":
                dbOpeningStock += qty;
                break;
              case "invoice":
                primaryPurchaseStock += qty;
                break;
              case "stockadjustment":
                stockAdjustment += qty;
                break;
              case "delivery":
                secondarySalesStock += qty; // Will be negative
                break;
              case "salesreturn":
                secondarySalesReturn += qty;
                break;
              case "purchasereturn":
                primaryPurchaseReturn += qty; // Will be negative
                break;
            }
          });

          // Get closing balances
          let closingStock =
            runningOpeningStock +
            dbOpeningStock +
            primaryPurchaseStock +
            stockAdjustment +
            secondarySalesStock +
            secondarySalesReturn +
            primaryPurchaseReturn;

          let closingPoints = runningOpeningPoints + totalPointsForDay;

          // "Basic" price columns = qty for that bucket * latest active rlp_price
          const openingStockPriceBasic = Number(
            (dbOpeningStock * basicPrice).toFixed(2),
          );
          const primaryPurchasePriceBasic = Number(
            (primaryPurchaseStock * basicPrice).toFixed(2),
          );
          const secondarySalesPriceBasic = Number(
            (secondarySalesStock * basicPrice).toFixed(2),
          );
          const secondarySalesReturnPriceBasic = Number(
            (secondarySalesReturn * basicPrice).toFixed(2),
          );
          const primaryPurchaseReturnPriceBasic = Number(
            (primaryPurchaseReturn * basicPrice).toFixed(2),
          );

          // Write CSV row
          csvStream.write({
            Date: currentDate.format("DD-MM-YYYY"),
            "Distributor Code": distributor.dbCode || "",
            "Distributor Name": distributor.name || "",
            State: distributor.stateId?.name || "",
            "Item Code": product.product_code || "",
            "Item Desc": product.name || "",
            "Product Type": product.product_type || "",
            Category: product.cat_id?.name || "",
            Segment: product.subBrand?.name || "",
            Brand: product.brand?.name || "",
            "Opening Stock Balance": runningOpeningStock,
            "DB Opening Stock (+)": dbOpeningStock,
            "Opening Stock Price (Basic)": openingStockPriceBasic,
            "Primary Purchase Stock (+)": primaryPurchaseStock,
            "Primary Purchase Price (Basic)": primaryPurchasePriceBasic,
            "Stock Adjustment (+-)": stockAdjustment,
            "Secondary Sales Stock (-)": secondarySalesStock,
            "Secondary Sales Price (Basic)": secondarySalesPriceBasic,
            "Secondary Sales Return (+)": secondarySalesReturn,
            "Secondary Sales Return Price (Basic)": secondarySalesReturnPriceBasic,
            "Primary Purchase Return (-)": primaryPurchaseReturn,
            "Primary Purchase Return Price (Basic)": primaryPurchaseReturnPriceBasic,
            "Closing Stock": closingStock,
          });

          // Update running balances for next day (still tracked internally for calc, just not in CSV)
          runningOpeningStock = closingStock;
          runningOpeningPoints = closingPoints;

          currentDate.add(1, "day");
        }
      }
    }

    csvStream.end();
  } catch (error) {
    console.error("Stock Ledger Report Error:", error);
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

module.exports = { dbTransactionStockLedgerReport };