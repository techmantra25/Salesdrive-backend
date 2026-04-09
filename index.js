const express = require("express");
const cors = require("cors");
const { PORT, NODE_ENV } = require("./config/server.config");
const { corsOptions } = require("./config/cors.config");
const v1Routes = require("./routes/v1.routes");
const v2Routes = require("./routes/v2.routes");
const { errorHandler, notFound } = require("./middlewares/error.middleware");
const connectDB = require("./db/db");
const { app: expressApp, server } = require("./server");
const notificationQueue = require("./queues/notificationQueue");
const { initSocket } = require("./socket");
const {
  startAutoPendingBillCron,
} = require("./jobs/crons/autoPendingBillDeliveryCron");
const {
  startPortalLockCheckCron,
} = require("./jobs/crons/portalLockCheckCron");
const {
  startPartiallyDeliveredBillRetryCron,
} = require("./jobs/crons/partiallyDeliveredBillRetryCron");

// ------------Static Cron imports-----------------
const {
  // keepSeverAliveJob,
  // fetchSecondaryOrderEntryJob,
  // fetchPrimaryInvoicesJob,
  // fetchProductPricesJob,
  // bulkPriceStatusUpdateJob,
  // fetchProductsJob,
  // fetchQuotationStatusJob,
  // AutoApprovePriceJob,
  // fetchOutletsJob,
  // balanceUpdateMorningAfternoonJob,
  // balanceUpdateEveningJob,
  // // cronRetryAllFailedInvoiceAdjustmentsJob,
  // syncOutletCodeUpdatesJob,
} = require("./jobs/cron");

const app = expressApp;

// Connect DB
connectDB();

// Security Middleware - Helmet (must be before other middleware)
const helmetConfig = require("./middlewares/helmet");
app.use(helmetConfig);

// Middleware setup
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.text());
app.use(cors(corsOptions));
const cookieParser = require("cookie-parser");

app.use(cookieParser());

// Health check
// keepSeverAliveJob.start();
// fetchSecondaryOrderEntryJob.start();
// fetchPrimaryInvoicesJob.start();
// fetchProductPricesJob.start();
// bulkPriceStatusUpdateJob.start();
// fetchProductsJob.start();
// fetchQuotationStatusJob.start();
// AutoApprovePriceJob.start();
// fetchOutletsJob.start();
// balanceUpdateMorningAfternoonJob.start();
// balanceUpdateEveningJob.start();
// // cronRetryAllFailedInvoiceAdjustmentsJob.start();
// syncOutletCodeUpdatesJob.start();

// Health check route
app.get("/", (req, res) => {
  res.status(200).json({
    error: false,
    status: 200,
    message: "Server is alive!..",
  });
});

// Routes
app.use("/api/v1/", v1Routes);
app.use("/api/v2/", v2Routes);

// Other queues
require("./jobs/syncInventoryQueue");
require("./jobs/syncGRNQueue");

// Cron jobs (unchanged)
if (NODE_ENV !== "development" && NODE_ENV !== "testing") {
  console.log("Starting cron jobs");
  require("./jobs/rbp/NewprocessRetailerMultiplierPoints");
}

// Error handlers
app.use(notFound);
app.use(errorHandler);

const bootstrapServer = async () => {
  await startAutoPendingBillCron();
  await startPortalLockCheckCron();
  await startPartiallyDeliveredBillRetryCron();

  server.listen(PORT, () => {
    console.log(`Server started on port ${PORT} in ${NODE_ENV} mode`);

    try {
      initSocket(server);
      console.log("Socket initialized successfully");
    } catch (err) {
      console.error("Socket initialization error:", err);
    }

    require("./workers/notificationWorker");
  });
};

bootstrapServer();
