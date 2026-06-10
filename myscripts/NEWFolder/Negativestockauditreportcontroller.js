const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const StockLedger = require("../../models/stockLedger.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");

const TIMEZONE = "Asia/Kolkata";

// /**
//  * GET /api/reports/negative-stock-audit
//  *
//  * Query params:
//  *   distributorId   – single distributor ObjectId  (optional if distributorIds given)
//  *   distributorIds  – comma-separated list OR "all"
//  *   startDate       – YYYY-MM-DD  (optional – defaults to all-time)
//  *   endDate         – YYYY-MM-DD  (optional – defaults to today)
//  *
//  * Output: CSV with one row per (distributor, product, "first negative day").
//  *
//  * Logic recap
//  * -----------
//  * For each product we replay the ledger day-by-day (chronologically).
//  * The moment closing stock first goes negative we record the "problem day".
//  * The required fix = Math.abs(closingStock) on that day → that amount added
//  * to the opening stock of that day would bring closing to exactly 0.
//  *
//  * We then continue the simulation with the patched running balance so that
//  * subsequent problem days (if any) are detected correctly AFTER the first fix
//  * has been applied – i.e. we carry forward the cumulative adjustment.
//  *
//  * Report columns
//  * ---------------
//  * Distributor Code | Distributor Name | Item Code | Item Desc | Brand | State
//  * | Problem Date
//  * | Opening Stock (original)
//  * | Negative Transactions Total   ← sum of delivery + negative stockadjustment for that day
//  * | Closing Stock (original)      ← the negative value
//  * | Stock Deficit                 ← abs(closing) = amount that must be added to opening
//  * | Cumulative Adjustment So Far  ← total opening-stock top-up needed up to & including this row
//  */


const negativeStockAuditReport = asyncHandler(async (req, res) => {
  try {
    const { distributorId, distributorIds, startDate, endDate } = req.query;

    console.log("udi baba ami jani na")

    /* ------------------------------------------------------------------ */
    /* DATE RANGE                                                           */
    /* ------------------------------------------------------------------ */
    const parsedStart = startDate
      ? moment.tz(startDate, TIMEZONE).startOf("day")
      : null;

    const parsedEnd = endDate
      ? moment.tz(endDate, TIMEZONE).endOf("day")
      : moment.tz(TIMEZONE).endOf("day");

    if (startDate && !parsedStart.isValid()) {
      res.status(400);
      throw new Error(`Invalid startDate: ${startDate}`);
    }
    if (!parsedEnd.isValid()) {
      res.status(400);
      throw new Error(`Invalid endDate: ${endDate}`);
    }

    const endOfDay = parsedEnd.toDate();

    /* ------------------------------------------------------------------ */
    // /* FETCH DISTRIBUTORS                                                   */
    /* ------------------------------------------------------------------ */
    let distQuery = {};

    if (distributorIds && distributorIds !== "all") {
      distQuery._id = { $in: distributorIds.split(",").map((s) => s.trim()) };
    } else if (distributorId) {
      distQuery._id = distributorId;
    }

    const distributors = await Distributor.find(distQuery).populate(
      "stateId",
      "name"
    );

    if (!distributors.length) {
      res.status(404);
      throw new Error("No distributors found");
    }

    /* ------------------------------------------------------------------ */
    /* CSV SETUP                                                            */
    /* ------------------------------------------------------------------ */
    const headers = [
      "Distributor Code",
      "Distributor Name",
      "Item Code",
      "Item Desc",
      "Brand",
      "State",
      "Problem Date",
      "Opening Stock (Original)",
      "Negative Transactions Total",
      "Closing Stock (Original)",
      "Stock Deficit (Add to Opening)",
      "Cumulative Adjustment",
    ];

    const fileName = `negative-stock-audit-${moment()
      .tz(TIMEZONE)
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({ headers });
    csvStream.pipe(res);

    /* ------------------------------------------------------------------ */
    /* PROCESS EACH DISTRIBUTOR                                            */
    /* ------------------------------------------------------------------ */
    for (const distributor of distributors) {
      const distributorIdObj = distributor._id;

      /* ---- gather all products that have ledger entries -------------- */
      const dateFilter = parsedStart
        ? { $gte: parsedStart.toDate(), $lte: endOfDay }
        : { $lte: endOfDay };

      const productsInRange = await StockLedger.distinct("productId", {
        distributorId: distributorIdObj,
        date: dateFilter,
      });

      // Also include products that had a non-zero opening balance before the
      // window start so we don't miss carried-forward negative stock.
      const productsWithBalance = parsedStart
        ? await StockLedger.aggregate([
            {
              $match: {
                distributorId: distributorIdObj,
                date: { $lt: parsedStart.toDate() },
              },
            },
            { $group: { _id: "$productId", total: { $sum: "$qtyChange" } } },
            { $match: { total: { $ne: 0 } } },
          ])
        : [];

      const allProductIds = [
        ...new Set([
          ...productsInRange.map(String),
          ...productsWithBalance.map((p) => String(p._id)),
        ]),
      ];

      if (!allProductIds.length) continue;

      const products = await Product.find({
        _id: { $in: allProductIds },
      })
        .select("name product_code brand")
        .populate("brand", "name");

      /* ---- process each product -------------------------------------- */
      for (const product of products) {
        const productIdObj = product._id;

        // --- opening balance before window start ----------------------
        const openingAgg = parsedStart
          ? await StockLedger.aggregate([
              {
                $match: {
                  distributorId: distributorIdObj,
                  productId: productIdObj,
                  date: { $lt: parsedStart.toDate() },
                },
              },
              { $group: { _id: null, totalQty: { $sum: "$qtyChange" } } },
            ])
          : [];

        let runningStock = openingAgg[0]?.totalQty ?? 0;

        // --- all ledger entries in window, sorted by date -------------
        const ledgerEntries = await StockLedger.find({
          distributorId: distributorIdObj,
          productId: productIdObj,
          date: dateFilter,
        }).sort({ date: 1 });

        if (!ledgerEntries.length && runningStock >= 0) continue;

        // --- group by date --------------------------------------------
        const entriesByDate = {};
        for (const entry of ledgerEntries) {
          const dk = moment.tz(entry.date, TIMEZONE).format("YYYY-MM-DD");
          if (!entriesByDate[dk]) entriesByDate[dk] = [];
          entriesByDate[dk].push(entry);
        }

        // --- determine date iteration range --------------------------
        const firstEntryDate =
          ledgerEntries.length > 0
            ? moment.tz(ledgerEntries[0].date, TIMEZONE)
            : parsedStart ?? moment.tz(endOfDay, TIMEZONE);

        const iterStart =
          parsedStart && parsedStart.isBefore(firstEntryDate)
            ? parsedStart.clone()
            : firstEntryDate.clone().startOf("day");

        const iterEnd = moment.tz(endOfDay, TIMEZONE);

        // --- simulate daily, detect negatives ------------------------
        let cumulativeAdjustment = 0;
        const current = iterStart.clone();

        while (current.isSameOrBefore(iterEnd, "day")) {
          const dk = current.format("YYYY-MM-DD");
          const dayEntries = entriesByDate[dk] || [];

          if (dayEntries.length === 0 && runningStock >= 0) {
            current.add(1, "day");
            continue;
          }

          // aggregate transaction types for the day
          let dbOpeningStock = 0;
          let primaryPurchase = 0;
          let stockAdjustment = 0;
          let secondarySales = 0;
          let salesReturn = 0;
          let purchaseReturn = 0;

          for (const e of dayEntries) {
            switch (e.transactionType) {
              case "openingstock":
                dbOpeningStock += e.qtyChange;
                break;
              case "invoice":
                primaryPurchase += e.qtyChange;
                break;
              case "stockadjustment":
                stockAdjustment += e.qtyChange;
                break;
              case "delivery":
                secondarySales += e.qtyChange; // already negative
                break;
              case "salesreturn":
                salesReturn += e.qtyChange;
                break;
              case "purchasereturn":
                purchaseReturn += e.qtyChange; // already negative
                break;
            }
          }

          const originalOpening = runningStock;

          const closingStock =
            runningStock +
            dbOpeningStock +
            primaryPurchase +
            stockAdjustment +
            secondarySales +
            salesReturn +
            purchaseReturn;

          if (closingStock < 0) {
            // deficit: how much we need to add to this day's opening so
            // that closing becomes exactly 0
            const deficit = Math.abs(closingStock);
            cumulativeAdjustment += deficit;

            // negative transactions for reporting (sales + negative adjustments)
            const negativeTransactions =
              secondarySales + Math.min(0, stockAdjustment) + purchaseReturn;

            csvStream.write({
              "Distributor Code": distributor.dbCode || "",
              "Distributor Name": distributor.name || "",
              "Item Code": product.product_code || "",
              "Item Desc": product.name || "",
              Brand: product.brand?.name || "",
              State: distributor.stateId?.name || "",
              "Problem Date": current.format("DD-MM-YYYY"),
              "Opening Stock (Original)": originalOpening,
              "Negative Transactions Total": negativeTransactions,
              "Closing Stock (Original)": closingStock,
              "Stock Deficit (Add to Opening)": deficit,
              "Cumulative Adjustment": cumulativeAdjustment,
            });

            // carry forward 0 (as if the fix was already applied) so
            // subsequent days are evaluated correctly
            runningStock = 0;
          } else {
            runningStock = closingStock;
          }

          current.add(1, "day");
        }
      }
    }

    csvStream.end();
  } catch (error) {
    console.error("Negative Stock Audit Report Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: true, message: error.message });
    }
  }
});

module.exports = { negativeStockAuditReport };