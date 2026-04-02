// processRetailerMultiplierPoints.js
const PQueue = require("p-queue").default;
const axios = require("axios");
const cron = require("node-cron");
const { SERVER_URL } = require("../../config/server.config");
const OutletApproved = require("../../models/outletApproved.model");
const generateToken = require("../../utils/generateToken");
const Bill = require("../../models/bill.model");

const processRetailerMultiplierPoints = new PQueue({ concurrency: 1 });

async function processRetailerMultiplierForRetailer(retailer) {
  try {
    console.log(
      `Starting retailer multiplier processing for retailer: ${retailer.outletName} (${retailer._id})`
    );

    // Get previous month and year
    const now = new Date();
    const previousMonth = now.getMonth(); // getMonth() returns 0-11, so current month - 1 gives us last month
    const year =
      previousMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = previousMonth === 0 ? 12 : previousMonth;

    const requestData = {
      month: month,
      year: year,
      retailerId: retailer._id.toString(),
    };

    const response = await axios.post(
      `${SERVER_URL}/api/v2/retailer-transaction/process-retailer-multiplier-transaction`,
      requestData,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 300000,
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(
        `Successfully processed retailer multiplier for retailer: ${retailer.outletName} (${retailer._id}) for ${month}/${year}`
      );
    } else {
      console.error(
        `Unexpected response status for retailer: ${retailer.outletName} (${retailer._id})`,
        response.status
      );
    }

    // Add delay after successful completion
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(
      `Error processing retailer multiplier for retailer ${retailer.outletName} (${retailer._id}):`,
      error.message
    );

    // Add delay even after error to prevent rapid retries
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function enqueueAllRetailers() {
  const bills = await Bill.find({
    status: "Delivered",
  }).distinct("retailerId");
  const uniqueRetailerIds = [...new Set(bills)];

  const retailers = await OutletApproved.find({
    _id: { $in: uniqueRetailerIds },
    status: true,
  }).select("_id outletName");

  // Add all retailers to queue without delay during enqueuing
  for (const retailer of retailers) {
    processRetailerMultiplierPoints.add(() =>
      processRetailerMultiplierForRetailer(retailer)
    );
  }

  console.log(
    `${retailers.length} eligible retailers enqueued for multiplier processing.`
  );
}

// Prevent overlapping runs
let isRunning = false;

async function startQueueIfNotRunning() {
  console.log("isRunning", isRunning);
  if (isRunning) {
    console.log(
      "Retailer multiplier processing queue is already running, skipping this execution."
    );
    return;
  }

  isRunning = true;
  console.log("Starting new retailer multiplier processing queue run...");

  try {
    await enqueueAllRetailers();
    await processRetailerMultiplierPoints.onIdle();
    console.log(
      "Retailer multiplier processing queue finished for this round."
    );
  } catch (err) {
    console.error("Error in retailer multiplier processing queue run:", err);
  } finally {
    isRunning = false;
  }
}

// Schedule to run on the 4th of every month at 05:15 AM
cron.schedule(
  "15 5 4 * *",
  () => {
    startQueueIfNotRunning();
  },
  null,
  true,
  "Asia/Kolkata"
);

// Schedule to run on the 1st of every month at 00:30 AM
// cron.schedule(
//   "* * * * *",
//   () => {
//     console.log("Cron triggered at:", new Date().toISOString());
//     startQueueIfNotRunning();
//   },
//   null,
//   true,
//   "Asia/Kolkata"
// );

// For testing - uncomment to run immediately
// setTimeout(() => {
//   console.log("Manual trigger for testing");
//   startQueueIfNotRunning();
// }, 5000);

module.exports = processRetailerMultiplierPoints;
