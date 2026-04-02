const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const StockLedger = require("../../models/stockLedger.model");
const Distributor = require("../../models/distributor.model");
const Brand = require("../../models/brand.model");
const Product = require("../../models/product.model");

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

    // if (brandIds) {
    //   if (brandIds === "all") {
    //     const brandAll = await Brand.find({});
    //     distributorQuery.brandId = {
    //       $in: brandAll.map((b) => b._id.toString()),
    //     };
    //   } else {
    //     const brandIdArray = brandIds.split(",").map((id) => id.trim());
    //     distributorQuery.brandId = { $in: brandIdArray };
    //   }
    // }if (brandIds) {
    //   if (brandIds === "all") {
    //     const brandAll = await Brand.find({});
    //     distributorQuery.brandId = {
    //       $in: brandAll.map((b) => b._id.toString()),
    //     };
    //   } else {
    //     const brandIdArray = brandIds.split(",").map((id) => id.trim());
    //     distributorQuery.brandId = { $in: brandIdArray };
    //   }
    // }

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
      "Item Code",
      "Item Desc",
      "Brand",
      "State",
      "Opening Stock Balance",
      "Opening Point Balance",
      "DB Opening Stock (+)",
      "Primary Purchase Stock (+)",
      "Stock Adjustment (+-)",
      "Secondary Sales Stock (-)",
      "Secondary Sales Return (+)",
      "Primary Purchase Return (-)",
      "Points",
      "Closing Stock",
      "Closing Point",
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

      // Get products that have transactions in date range
      const productsInRange = await StockLedger.distinct("productId", {
        distributorId: distributorIdObj,
        date: { $gte: startOfDay, $lte: endOfDay },
      });

      // Get products that have opening stock (last transaction before startDate > 0)
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

      // Combine both sets
      const allProductIds = [
        ...new Set([...productsInRange, ...productIdsWithStock]),
      ];

      if (!allProductIds.length) continue;

      // Fetch product details
      //old code
      // const products = await Product.find({
      //   _id: { $in: allProductIds },
      // }).select("name product_code base_point").populate("brand","name");

      const products = await Product.find({
        _id: { $in: allProductIds },
        ...(brandIds && brandIds !== "all"
          ? { brand: { $in: brandIds.split(",").map((id) => id.trim()) } }
          : {}),
      })
        .select("name product_code base_point brand")
        .populate("brand", "name");

      /* ---------- PROCESS EACH PRODUCT -------------------------- */

      for (const product of products) {
        const productIdObj = product._id;

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

        // const initialOpeningStock = openingEntry?.closingStock || 0;
        // const initialOpeningPoints = openingEntry?.closingPoints || 0;

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

          // Get closing balances from last entry of the day
          let closingStock =
            runningOpeningStock +
            dbOpeningStock +
            primaryPurchaseStock +
            stockAdjustment +
            secondarySalesStock + // already negative for deliveries
            secondarySalesReturn +
            primaryPurchaseReturn; // already negative for purchase returns

          let closingPoints = runningOpeningPoints + totalPointsForDay;

          // Write CSV row
          csvStream.write({
            Date: currentDate.format("DD-MM-YYYY"),
            "Distributor Code": distributor.dbCode || "",
            "Distributor Name": distributor.name || "",
            "Item Code": product.product_code || "",
            "Item Desc": product.name || "",
            Brand: product.brand?.name || "",
            State: distributor.stateId?.name || "",
            "Opening Stock Balance": runningOpeningStock,
            "Opening Point Balance": runningOpeningPoints,
            "DB Opening Stock (+)": dbOpeningStock,
            "Primary Purchase Stock (+)": primaryPurchaseStock,
            "Stock Adjustment (+-)": stockAdjustment,
            "Secondary Sales Stock (-)": secondarySalesStock,
            "Secondary Sales Return (+)": secondarySalesReturn,
            "Primary Purchase Return (-)": primaryPurchaseReturn,
            Points: totalPointsForDay,
            "Closing Stock": closingStock,
            "Closing Point": closingPoints,
          });

          // Update running balances for next day
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
