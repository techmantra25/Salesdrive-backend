// syncProductQueue.js [Not in USE]
const PQueue = require("p-queue").default;
const axios = require("axios");
const cron = require("node-cron");
const { SERVER_URL } = require("../config/server.config");

const syncProductQueue = new PQueue({ concurrency: 1 });

async function syncProductMaster(currentDate, previousDate) {
  try {
    console.log(
      `Starting product sync for currentDate: ${currentDate} and previousDate: ${previousDate}`
    );

    const response = await axios.get(
      `${SERVER_URL}/api/v1/external/sync-product-master?currentDate=${currentDate}&previousDate=${previousDate}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 300000,
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(
        `Successfully synced product master for currentDate: ${currentDate} and previousDate: ${previousDate}`
      );
    } else {
      console.error(
        `Unexpected response status for currentDate: ${currentDate} and previousDate: ${previousDate}`,
        response.status
      );
    }
  } catch (error) {
    console.error(
      `Error syncing product master for currentDate: ${currentDate} and previousDate: ${previousDate}:`,
      error.message
    );
  }
}

async function enqueueAllWeeks() {
  const dateQueue = [];

  // Helper to format date as DD.MM.YYYY
  function formatDate(date) {
    return `${date.getDate().toString().padStart(2, "0")}.${(
      date.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}.${date.getFullYear()}`;
  }

  // For each of the last 1 weeks
  for (let i = 0; i < 1; i++) {
    // current = today - (i * 7) days
    const current = new Date();
    current.setDate(current.getDate() - i * 7);

    // previous = current - 6 days (start of the week)
    const previous = new Date(current);
    previous.setDate(current.getDate() - 6);

    dateQueue.push({
      currentDate: formatDate(current),
      previousDate: formatDate(previous),
    });
  }

  // Enqueue jobs with 1 second delay between each
  for (const date of dateQueue) {
    syncProductQueue.add(() =>
      syncProductMaster(date.currentDate, date.previousDate)
    );
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
  }

  console.log("All weekly requests enqueued.", dateQueue);
}

// Prevent overlapping runs
let isRunning = false;

async function startQueueIfNotRunning() {
  if (isRunning) {
    return;
  }
  isRunning = true;
  try {
    await enqueueAllWeeks();
    await syncProductQueue.onIdle();
    console.log("Queue finished for this round.");
  } catch (err) {
    console.error("Error in queue run:", err);
  } finally {
    isRunning = false;
  }
}

// "*/1 * * * *"	every minute
// "* * * * * *"	every second

// Schedule with node-cron: every 6 hours 30 minutes minutes
// cron.schedule("30 */6 * * *", () => {
//   startQueueIfNotRunning();
// });

module.exports = syncProductQueue;
