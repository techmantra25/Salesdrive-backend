// syncGRNQueue.js
const PQueue = require("p-queue").default;
const axios = require("axios");
const cron = require("node-cron");
const { SERVER_URL } = require("../config/server.config");
const Distributor = require("../models/distributor.model");

const syncGRNQueue = new PQueue({ concurrency: 1 });

async function syncSAPGRNForDistributor(distributor) {
  try {
    console.log(
      `Starting sync for distributor: ${distributor.name} (${distributor.dbCode})`
    );

    const dbCode = distributor.dbCode;

    const response = await axios.get(
      `${SERVER_URL}/api/v1/external/fetch-sap-grn-data?neededDbCodes=${dbCode}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 300000,
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(
        `Successfully synced for distributor: ${distributor.name} (${distributor.dbCode})`
      );
    } else {
      console.error(
        `Unexpected response status for distributor: ${distributor.name} (${distributor.dbCode})`,
        response.status
      );
    }

    // Add delay after successful completion
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(
      `Error syncing for distributor ${distributor.name} (${distributor.dbCode}):`,
      error.message
    );

    // Add delay even after error to prevent rapid retries
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function enqueueAllDistributors() {
  const distributors = await Distributor.find({
    status: true,
    openingStock: true,
  }).select("_id name dbCode");

  // Add all distributors to queue without delay during enqueuing
  for (const distributor of distributors) {
    syncGRNQueue.add(() => syncSAPGRNForDistributor(distributor));
  }

  console.log(`${distributors.length} eligible distributors enqueued.`);
}

// Prevent overlapping runs
let isRunning = false;

async function startQueueIfNotRunning() {
  if (isRunning) {
    console.log("Queue is already running, skipping this execution.");
    return;
  }

  isRunning = true;
  console.log("Starting new queue run...");

  try {
    await enqueueAllDistributors();
    await syncGRNQueue.onIdle();
    console.log("Queue finished for this round.");
  } catch (err) {
    console.error("Error in queue run:", err);
  } finally {
    isRunning = false;
  }
}

// Schedule with node-cron: every 27 minute
cron.schedule("*/27 * * * *", () => {
  startQueueIfNotRunning();
});

module.exports = syncGRNQueue;
