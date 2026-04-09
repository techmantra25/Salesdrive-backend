// syncInventoryQueue.js
const PQueue = require("p-queue").default;
const axios = require("axios");
const cron = require("node-cron");
const { SERVER_URL } = require("../config/server.config");
const Distributor = require("../models/distributor.model");
const generateToken = require("../utils/generateToken");

const syncInventoryQueue = new PQueue({ concurrency: 1 });

async function syncInventoryForDistributor(distributor) {
  try {
    console.log(
      `Starting inventory sync for distributor: ${distributor.name} (${distributor.dbCode})`
    );

    const token = eq.cookies.DBToken || generateToken(distributor._id.toString());

    const response = await axios.get(
      `${SERVER_URL}/api/v1/inventory/sync-inventory-with-product-master`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 300000,
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(
        `Successfully synced inventory for distributor: ${distributor.name} (${distributor.dbCode})`
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
      `Error syncing inventory for distributor ${distributor.name} (${distributor.dbCode}):`,
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
    syncInventoryQueue.add(() => syncInventoryForDistributor(distributor));
  }

  console.log(
    `${distributors.length} eligible distributors enqueued for inventory sync.`
  );
}

// Prevent overlapping runs
let isRunning = false;

async function startQueueIfNotRunning() {
  if (isRunning) {
    console.log(
      "Inventory sync queue is already running, skipping this execution."
    );
    return;
  }

  isRunning = true;
  console.log("Starting new inventory sync queue run...");

  try {
    await enqueueAllDistributors();
    await syncInventoryQueue.onIdle();
    console.log("Inventory sync queue finished for this round.");
  } catch (err) {
    console.error("Error in inventory sync queue run:", err);
  } finally {
    isRunning = false;
  }
}

// Schedule with node-cron: every 37 minutes
// cron.schedule("*/37 * * * *", () => {
//   startQueueIfNotRunning();
// });

module.exports = syncInventoryQueue;
