const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const { billStockQueue, canEnqueue } = require("../../queues/billStockQueue");
const { processBillCancel } = require("../../workers/billingWorker");

const cancelBillUpdate = asyncHandler(async (req, res) => {
  try {
    const { billIds } = req.body; // [{ bid, remark }]

    // ─── 1. Input validation ────────────────────────────────────────────────
    if (!Array.isArray(billIds) || billIds.length === 0) {
      return res
        .status(400)
        .json({ message: "Invalid or empty billIds array" });
    }

    // ─── 2. Pre-flight checks (fast, before touching queue) ─────────────────
    const billIdArray = billIds.map((item) => item.bid);
    const bills = await Bill.find({ _id: { $in: billIdArray } });

    if (bills.length === 0) {
      return res.status(404).json({ message: "No bills found to cancel" });
    }

    const invalidBills = bills.filter(
      (bill) => bill.status === "Cancelled" || bill.status === "Delivered",
    );

    if (invalidBills.length > 0) {
      return res.status(400).json({
        message:
          "Some bills cannot be cancelled (already cancelled or delivered)",
        invalidBills: invalidBills.map((b) => ({
          billNo: b.billNo,
          status: b.status,
        })),
      });
    }

    // ─── 3. Try queue path first ────────────────────────────────────────────
    const redisAvailable = await canEnqueue(); // never throws

    if (redisAvailable) {
      try {
        const job = await billStockQueue.add("cancel-bills", { billIds });

        console.log(
          `✅ Bill cancellation queued — jobId: ${job.id}, count: ${billIds.length}`,
        );

        return res.status(202).json({
          success: true,
          message: "Bill cancellation queued for processing",
          jobId: job.id,
          queuedCount: billIds.length,
        });
      } catch (queueErr) {
        // Redis died between health check and enqueue — fall through
        console.warn(
          "⚠️ Queue.add() failed, falling back to direct processing:",
          queueErr.message,
        );
      }
    }

    // ─── 4. Direct fallback path ────────────────────────────────────────────
    console.log(
      `📋 Redis unavailable — cancelling ${billIds.length} bills directly`,
    );

    const result = await processBillCancel({ billIds });

    return res.status(200).json({
      success: true,
      message: "Bills cancelled successfully",
      ...result,
    });
  } catch (error) {
    console.error("❌ Bill cancellation error:", error);
    return res.status(500).json({
      message: "Failed to cancel bills",
      error: error.message,
    });
  }
});

module.exports = { cancelBillUpdate };
