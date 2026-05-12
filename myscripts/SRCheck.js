const mongoose = require("mongoose");
const StockLedger = require("../models/stockLedger.model");
const SalesReturnModel = require("../models/salesReturn.model");

// 🔧 CONFIG
const MONGO_URI =
  "mongodb://rupaAdmin:admin2025@127.0.0.1:27017/rupadms?authSource=rupadms";
const DISTRIBUTOR_ID = "69312c4d18d5fca618588588";

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to DB");

    const distId = new mongoose.Types.ObjectId(DISTRIBUTOR_ID);

    // 📅 Date range
    const startOfDay = new Date("2025-01-01T00:00:00.000Z");
    const endOfDay = new Date("2026-05-04T23:59:59.999Z");

    // 📦 STOCK LEDGER
    const result = await StockLedger.aggregate([
      {
        $match: {
          distributorId: distId,
          transactionType: "salesreturn",
          date: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $group: {
          _id: null,
          totalQty: { $sum: "$qtyChange" },
        },
      },
    ]);

    // 📦 SALES RETURN
    const salesReturnsAgg = await SalesReturnModel.aggregate([
      {
        $match: {
          distributorId: distId,
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $unwind: {
          path: "$lineItems",
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $group: {
          _id: null,
          totalQty: {
            $sum: { $ifNull: ["$lineItems.returnQty", 0] },
          },
        },
      },
    ]);

    console.log(
      "📊 Date Range:",
      startOfDay.toISOString(),
      "→",
      endOfDay.toISOString()
    );

    console.log("📦 StockLedger Qty:", result[0]?.totalQty || 0);
    console.log("📦 SalesReturn Qty:", salesReturnsAgg[0]?.totalQty || 0);

  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected");
  }
})();