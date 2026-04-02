// services/updateOutletBalances.js
const axios = require("axios");
const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const { acquireLock, releaseLock } = require("../../models/lock.model");
const {
  ALL_RETAILER_CURRENT_RBP_POINT_BALANCE,
} = require("../../config/retailerApp.config");

/**
 * Update outlet balances from external API
 */
const fetchRetailerCurrentPointBalance = asyncHandler(async (req, res) => {
  const lockKey = "updateOutletBalances";

  if (!(await acquireLock(lockKey))) {
    console.log("❌ Balance update already in progress, skipping...");
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }

  console.log("🚀 Starting outlet balance update process...");
  const startTime = Date.now();

  try {
    // Step 1: Fetch balance data from API
    console.log("📡 Fetching balance data from external API...");
    const response = await axios({
      method: "GET",
      url: ALL_RETAILER_CURRENT_RBP_POINT_BALANCE,
      timeout: 60000, // 60 seconds timeout
    });

    const balanceData = response?.data?.data || [];

    if (!balanceData || balanceData.length === 0) {
      console.log("⚠️ No balance data received from API");
      return res.status(404).json({
        error: true,
        message: "No balance data received from API",
      });
    }
    console.log(`✅ Received ${balanceData.length} balance records from API`);

    // Step 2: Create balance lookup map using retailer_id (which is _id of outlet)
    const balanceMap = new Map();
    balanceData.forEach((item) => {
      if (item.retailer_id && item.wallet_balance !== undefined) {
        balanceMap.set(
          item.retailer_id.toString(),
          parseFloat(item.wallet_balance) || 0
        );
      }
    });

    console.log(`📋 Created balance map with ${balanceMap.size} entries`);

    // Step 3: Process outlets in batches
    const BATCH_SIZE = 2000; // Process 2000 outlets at a time
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let skip = 0;
    let batchNumber = 1;

    while (true) {
      console.log(
        `🔄 Processing batch ${batchNumber} (${skip} to ${skip + BATCH_SIZE})`
      );

      // Fetch outlets batch
      const outlets = await OutletApproved.find({ status: true })
        .select("_id currentPointBalance")
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (outlets.length === 0) {
        console.log("✅ All batches processed");
        break;
      }

      // Prepare bulk operations for this batch
      const bulkOperations = [];

      outlets.forEach((outlet) => {
        totalProcessed++;

        const outletId = outlet._id.toString();
        if (!balanceMap.has(outletId)) {
          totalSkipped++;
          return;
        }

        const newBalance = balanceMap.get(outletId);
        const currentBalance = outlet.currentPointBalance || 0;

        // Only update if balance has changed
        if (Math.abs(newBalance - currentBalance) > 0.0001) {
          bulkOperations.push({
            updateOne: {
              filter: { _id: outlet._id },
              update: {
                $set: {
                  currentPointBalance: newBalance,
                },
              },
            },
          });
        } else {
          totalSkipped++;
        }
      });

      // Execute bulk operations
      if (bulkOperations.length > 0) {
        try {
          const bulkResult = await OutletApproved.bulkWrite(bulkOperations, {
            ordered: false,
          });

          totalUpdated += bulkResult.modifiedCount;
          console.log(
            `✅ Batch ${batchNumber} completed - Updated: ${bulkResult.modifiedCount} outlets`
          );
        } catch (error) {
          console.error(
            `❌ Bulk write failed for batch ${batchNumber}:`,
            error.message
          );
        }
      } else {
        console.log(`⏭️ Batch ${batchNumber} - No updates needed`);
      }

      skip += BATCH_SIZE;
      batchNumber++;

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Log final statistics
    const totalTime = Date.now() - startTime;
    console.log("\n" + "=".repeat(50));
    console.log("📊 BALANCE UPDATE SUMMARY");
    console.log("=".repeat(50));
    console.log(`⏱️  Total Time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`📋 Total Processed: ${totalProcessed}`);
    console.log(`✅ Total Updated: ${totalUpdated}`);
    console.log(`⏭️  Total Skipped: ${totalSkipped}`);
    console.log(
      `📈 Success Rate: ${
        totalProcessed > 0
          ? ((totalUpdated / totalProcessed) * 100).toFixed(2)
          : 0
      }%`
    );
    console.log("=".repeat(50) + "\n");

    res.status(200).json({
      error: false,
      message: "Outlet balance update completed successfully",
      data: {
        totalProcessed,
        totalUpdated,
        totalSkipped,
        executionTime: totalTime,
        successRate:
          totalProcessed > 0
            ? ((totalUpdated / totalProcessed) * 100).toFixed(2)
            : 0,
        balanceRecordsReceived: balanceData.length,
        balanceEntriesMapped: balanceMap.size,
      },
    });
  } catch (error) {
    console.error("❌ Balance update failed:", error.message);
    res.status(400);
    throw error;
  } finally {
    await releaseLock(lockKey);
    console.log("🔓 Balance update lock released");
  }
});

module.exports = { fetchRetailerCurrentPointBalance };
