const cron = require("cron");
const axios = require("axios");
const { API_URL } = require("../config/server.config");
const { SERVER_URL } = require("../config/server.config");
const { writeLog, getLogFilePath } = require("../writeLog");

// to keep the server running & alive
// const keepSeverAliveJob = new cron.CronJob("*/20 * * * *", async function () {
//   try {
//     const res = await axios.get(API_URL);
//     if (res.status === 200) {
//       console.log("GET request sent successfully");
//       console.log("API_URL is: ", API_URL);
//       console.log("SERVER_URL is: ", SERVER_URL);
//     } else {
//       console.log("GET request failed", res.status);
//     }
//   } catch (e) {
//     console.error("Error while sending request", e.message);
//   }
// });

// to fetch secondary order entry data every 20 minutes between 7am to 8pm
const fetchSecondaryOrderEntryJob = new cron.CronJob(
  "*/20 7-20 * * *",
  async function () {
    try {
      const res = await axios.get(
        `${API_URL}/api/v1/external/fetch-sap-secondary-order-entry-data`,
      );
      if (res.status === 200) {
        console.log("Secondary order entry data fetched successfully");
      } else {
        console.log("Failed to fetch secondary order entry data", res.status);
      }
    } catch (e) {
      console.error(
        "Error while fetching secondary order entry data",
        e.message,
      );
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// to fetch primary invoices every 3 hours 23 minutes between 6am to 7pm
const fetchPrimaryInvoicesJob = new cron.CronJob(
  "23 6-19/3 * * *",
  async function () {
    try {
      const res = await axios.get(
        `${API_URL}/api/v1/external/fetch-sap-grn-data`,
      );
      if (res.status === 200) {
        console.log("Primary invoices data fetched successfully");
      } else {
        console.log("Failed to fetch primary invoices data", res.status);
      }
    } catch (e) {
      console.error("Error while fetching primary invoices data", {
        message: e.message,
        status: e.response?.status,
        data: e.response?.data,
      });
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// to fetch products every 5 hours 39 minutes between 9am to 9pm
const fetchProductsJob = new cron.CronJob(
  "39 9-21/5 * * *",
  async function () {
    try {
      const res = await axios.get(
        `${API_URL}/api/v1/external/sync-product-master`,
      );
      if (res.status === 200) {
        console.log("Products fetched successfully");
      } else {
        console.log("Failed to fetch products data", res.status);
      }
    } catch (e) {
      console.error("Error while fetching products data", e.message);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// to quotation status every 2 hours 11 minutes from 8am to 2pm
const fetchQuotationStatusJob = new cron.CronJob(
  "11 8-14/2 * * *",
  async function () {
    try {
      const res = await axios.post(
        `${API_URL}/api/v1/external/fetch-quotation-status`,
        {},
      );
      if (res.status === 200) {
        console.log("Quotation status fetched successfully");
      } else {
        console.log(
          `Failed to fetch quotation status: ${res.statusText} - Status Code: ${res.status}`,
          res.status,
        );
      }
    } catch (e) {
      console.error(`Error while fetching quotation status: ${e.message}`);
    }
  },
);

// to fetch product prices every day 9pm
const fetchProductPricesJob = new cron.CronJob(
  "0 21 * * *",
  async function () {
    try {
      writeLog(
        `CRON_SYNC_PRICE_MASTER_START: ${new Date().toLocaleTimeString()}`,
      );
      let currentDate = new Date()
        .toLocaleDateString("en-GB", {
          timeZone: "Asia/Kolkata",
        })
        .split("/")
        .join(".");

      const res = await axios.get(
        `${API_URL}/api/v1/external/sync-price-master?currentDate=${currentDate}&previousDate=${currentDate}`,
      );
      if (res.status === 200) {
        writeLog(
          `CRON_SYNC_PRICE_MASTER_SUCCESS: ${new Date().toLocaleTimeString()}`,
        );
        console.log("Product prices synced successfully");
      } else {
        writeLog(
          `CRON_SYNC_PRICE_MASTER_FAILED: ${new Date().toLocaleTimeString()}`,
        );
        console.log("Failed to sync product prices", res.status);
      }
    } catch (e) {
      writeLog(
        `CRON_SYNC_PRICE_MASTER_FAILED_ERROR: ${e.message} - ${new Date().toLocaleTimeString()}`,
      );
      console.error("Error while syncing product prices", e.message);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);
// to fetch product prices every day 10.00pm
const fetchRegionalProductPricesJob = new cron.CronJob(
  "0 22 * * *",
  async function () {
    try {
      writeLog(
        `CRON_SYNC_REGIONAL_PRICE_START: ${new Date().toLocaleTimeString()}`,
      );
      let currentDate = new Date()
        .toLocaleDateString("en-GB", {
          timeZone: "Asia/Kolkata",
        })
        .split("/")
        .join(".");

      const res = await axios.get(
        `${API_URL}/api/v1/external/sync-regional-price?previousDate=01.01.2020`,
      );
      if (res.status === 200) {
        writeLog(
          `CRON_SYNC_REGIONAL_PRICE_SUCCESS: ${new Date().toLocaleTimeString()}`,
        );
        console.log("Product prices synced successfully");
      } else {
        writeLog(
          `CRON_SYNC_REGIONAL_PRICE_FAILED: ${new Date().toLocaleTimeString()}`,
        );
        console.log("Failed to sync product prices", res.status);
      }
    } catch (e) {
      writeLog(
        `CRON_SYNC_REGIONAL_PRICE_FAILED_ERROR: ${e.message} - ${new Date().toLocaleTimeString()}`,
      );
      console.error("Error while syncing product prices", e.message);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// to fetch product prices every day at 9.30pm
const AutoApprovePriceJob = new cron.CronJob(
  "30 21 * * *",
  async function () {
    try {
      writeLog(
        `CRON_AUTO_APPROVE_PRICE_CSV_START: ${new Date().toLocaleTimeString()}`,
      );
      const res = await axios.get(
        `${API_URL}/api/v1/price-csv/auto-approve-price-csv`,
      );
      if (res.status === 200) {
        writeLog(
          `CRON_AUTO_APPROVE_PRICE_CSV_SUCCESS: ${new Date().toLocaleTimeString()}`,
        );
        console.log("Auto-approve price CSVs processed successfully");
      } else {
        writeLog(
          `CRON_AUTO_APPROVE_PRICE_CSV_FAILED: ${new Date().toLocaleTimeString()}`,
        );
        console.log(`
          Failed to auto-approve price CSVs: ${res.statusText} - Status Code: ${res.status}
          `);
      }
    } catch (e) {
      writeLog(
        `CRON_AUTO_APPROVE_PRICE_CSV_FAILED_ERROR: ${e.message} - ${new Date().toLocaleTimeString()}`,
      );
      console.error(`
        Error while auto-approving price CSVs: ${e.message}
        `);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// to fetch product prices every day at 10.30pm
const AutoApproveRegionalPriceJob = new cron.CronJob(
  "30 22 * * *",
  async function () {
    try {
      writeLog(
        `CRON_AUTO_APPROVE_REGIONAL_PRICE_CSV_START: ${new Date().toLocaleTimeString()}`,
      );
      const res = await axios.get(
        `${API_URL}/api/v1/price-csv/auto-approve-price-csv`,
      );
      if (res.status === 200) {
        writeLog(
          `CRON_AUTO_APPROVE_REGIONAL_PRICE_CSV_SUCCESS: ${new Date().toLocaleTimeString()}`,
        );
        console.log("Auto-approve price CSVs processed successfully");
      } else {
        writeLog(
          `CRON_AUTO_APPROVE_REGIONAL_PRICE_CSV_FAILED: ${new Date().toLocaleTimeString()}`,
        );
        console.log(`
          Failed to auto-approve price CSVs: ${res.statusText} - Status Code: ${res.status}
          `);
      }
    } catch (e) {
      writeLog(
        `CRON_AUTO_APPROVE_REGIONAL_PRICE_CSV_FAILED_ERROR: ${e.message} - ${new Date().toLocaleTimeString()}`,
      );
      console.error(`
        Error while auto-approving price CSVs: ${e.message}
        `);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// bulk price status update job every 53 minutes between 4pm to 9pm
const bulkPriceStatusUpdateJob = new cron.CronJob(
  "*/53 16-23 * * *",
  async function () {
    try {
      const res = await axios.put(
        `${API_URL}/api/v1/price/bulk-update-status`,
        {},
      );
      if (res.status === 200) {
        console.log("Bulk price status updated successfully");
      } else {
        console.log("Failed to update bulk price status", res.status);
      }
    } catch (e) {
      console.error("Error while updating bulk price status", e.message);
    }
  },
);

// to fetch outlets every 1 hour between 10am to 8pm
const fetchOutletsJob = new cron.CronJob(
  "0 10-20/1 * * *",
  async function () {
    try {
      const res = await axios.get(`${API_URL}/api/v1/external/fetch-outlets`);
      if (res.status === 200) {
        console.log("Outlets synced successfully");
      } else {
        console.log("Failed to sync Outlets", res.status);
      }
    } catch (e) {
      console.error("Error while syncing Outlets", e.message);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// separate jobs for better control
const balanceUpdateMorningAfternoonJob = new cron.CronJob(
  "45 6,14,17 * * *", // 6:45 AM and 2:45 PM and 5:45pm daily
  async function () {
    try {
      console.log("🚀 Starting scheduled outlet balance update...");
      const res = await axios.get(
        `${API_URL}/api/v1/external/fetch-all-outlets-current-balance`,
      );
      if (res.status === 200) {
        console.log("✅ Outlet balance update completed successfully");
      } else {
        console.log("❌ Outlet balance update failed or skipped");
      }
    } catch (error) {
      console.error("Error while updating outlet balances:", error.message);
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

const balanceUpdateEveningJob = new cron.CronJob(
  "30 21 * * *", // 9:30 PM daily
  async function () {
    try {
      console.log("🌙 Starting evening outlet balance update...");
      const res = await axios.get(
        `${API_URL}/api/v1/external/fetch-all-outlets-current-balance`,
      );
      if (res.status === 200) {
        console.log("✅ Outlet balance update completed successfully");
      } else {
        console.log("❌ Outlet balance update failed or skipped");
      }
    } catch (error) {
      console.error(
        "Error while updating outlet balances (evening):",
        error.message,
      );
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

// const cronRetryAllFailedRbpTransactions = new cron.CronJob(
//   "0 14,20 * * *", // 2 PM  and 8p PM daily
//   async function () {
//     try {
//       console.log("🌙 Starting All Failed Transection Sync...");
//       const res = await axios.get(
//         `${API_URL}/api/v1/db-transaction/cron-all-retry-distributor-transaction`,
//       );
//       if (res.status === 200) {
//         console.log("✅All Failed Transection Sync Sucessfully");
//       } else {
//         console.log("❌ Failed to Syncing All Failed Transaction");
//       }
//     } catch (error) {
//       console.error("Error while Syn (evening):", error.message);
//     }
//   },
//   null,
//   true,
//   "Asia/Kolkata",
// );

// const cronRetryAllFailedInvoiceAdjustmentsJob = new cron.CronJob(
//   "30 20 * * *", // 8:30 PM daily (after RBP retry)
//   async function () {
//     try {
//       console.log("🔁 Starting Failed Invoice Adjustment Retry (CRON)...");

//       const res = await axios.post(
//         `${API_URL}/api/v1/invoice/cron-retry-failed-adjustments`
//       );

//       if (res.status === 200) {
//         console.log(
//           "✅ Failed Invoice Adjustments Retried Successfully",
//           res.data?.summary || ""
//         );
//       } else {
//         console.log(
//           "❌ Failed Invoice Adjustment Retry returned non-200",
//           res.status
//         );
//       }
//     } catch (error) {
//       console.error(
//         "🔥 Error during Invoice Adjustment Retry Cron:",
//         error.response?.data || error.message
//       );
//     }
//   },
//   null,
//   true,
//   "Asia/Kolkata"
// );

// // "*/1 * * * *"	every minute
// // "* * * * * *"	every second
// // "0 0 * * *"	every day at midnight
// // "55 23 * * *"  every day at 11:55 PM"

// Sync Outlet Code Updates - Daily at 3:30 AM
const syncOutletCodeUpdatesJob = new cron.CronJob(
  "30 03 * * *", // 3:30 AM daily
  async function () {
    try {
      console.log("🔄 Starting Outlet Code Updates Sync (CRON)...");

      const res = await axios.get(
        `${API_URL}/api/v1/external/sync-outlet-code-updates`,
      );

      if (res.status === 200) {
        console.log(
          "✅ Outlet Code Updates Synced Successfully",
          res.data?.metadata || "",
        );
      } else {
        console.log(
          "❌ Outlet Code Updates Sync returned non-200 status",
          res.status,
        );
      }
    } catch (error) {
      console.error(
        "🔥 Error during Outlet Code Updates Sync Cron:",
        error.response?.data || error.message,
      );
    }
  },
  null,
  true,
  "Asia/Kolkata",
);

module.exports = {
  // keepSeverAliveJob,
  fetchSecondaryOrderEntryJob,
  fetchProductsJob,
  fetchPrimaryInvoicesJob,
  fetchProductPricesJob,
  bulkPriceStatusUpdateJob,
  fetchQuotationStatusJob,
  AutoApprovePriceJob,
  fetchOutletsJob,
  balanceUpdateMorningAfternoonJob,
  balanceUpdateEveningJob,
  // cronRetryAllFailedInvoiceAdjustmentsJob,

  syncOutletCodeUpdatesJob,
};
