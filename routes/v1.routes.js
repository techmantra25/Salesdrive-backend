const express = require("express");
const userRoutes = require("./v1Routes/user.routes");
const categoryRoutes = require("./v1Routes/category.routes");
const collectionRoutes = require("./v1Routes/collection.routes");
const productRoutes = require("./v1Routes/product.routes");
const dashboardRoutes = require("./v1Routes/dashboard.routes");
const priceRoutes = require("./v1Routes/price.routes");
const zoneRoutes = require("./v1Routes/zone.routes");
const regionRoutes = require("./v1Routes/region.routes");
const stateRoutes = require("./v1Routes/state.routes");
const brandRoutes = require("./v1Routes/brand.routes");
const fileUploadRoutes = require("./v1Routes/fileUpload.routes");
const cloudinaryRoutes = require("./v1Routes/cloudinary.routes");
const passwordRoutes = require("./v1Routes/password.routes");
const distributorRoutes = require("./v1Routes/distributer.routes");
const designationRoutes = require("./v1Routes/designation.routes");
const employeeRoutes = require("./v1Routes/employee.routes");
const beatRoutes = require("./v1Routes/beat.routes");
const outletRoutes = require("./v1Routes/outlet.routes");
const outletApprovedRoutes = require("./v1Routes/outletApproved.routes");
const inventoryRoutes = require("./v1Routes/inventory.routes");
const transactionRoutes = require("./v1Routes/transaction.routes");
const invoiceRoutes = require("./v1Routes/invoice.routes");
const transactionDraftRoutes = require("./v1Routes/transactionDraft.routes");
const reportRouter = require("./v1Routes/reportRequest.routes");
const bankRoutes = require("./v1Routes/bank.routes");
const branchRoutes = require("./v1Routes/branch.routes");
const deliveryBoyRoutes = require("./v1Routes/deliveryBoy.routes");
const billSeriesRoutes = require("./v1Routes/billSeries.routes");
const orderEntryRoutes = require("./v1Routes/orderEntry.routes");
const reasonRoutes = require("./v1Routes/reason.routes");
const billRoutes = require("./v1Routes/bill.routes");
const dbRuleRoutes = require("./v1Routes/dbRule.routes");
const vehicleRoutes = require("./v1Routes/vehicle.routes");
const loadSheetRoutes = require("./v1Routes/loadSheet.routes");
const salesReturnRoutes = require("./v1Routes/salesReturn.routes");
const creditNoteRoutes = require("./v1Routes/creditNote.routes");
const replacementRoutes = require("./v1Routes/replacement.routes");
const ledgerRoutes = require("./v1Routes/ledger.routes");
const ledgerCollectionRoutes = require("./v1Routes/ledgerCollection.routes");
const supplierRoutes = require("./v1Routes/supplier.routes");
const productNormsRoutes = require("./v1Routes/productNorms.routes");
const purchaseOrderRoutes = require("./v1Routes/purchaseOrder.routes");
const configRoutes = require("./v1Routes/config.routes");
const retailerTnCRoutes = require("./v1Routes/retailerTnC.routes");
const giftProductRoutes = require("./v1Routes/giftProduct.routes");
const catalogueRoutes = require("./v1Routes/catalogue.routes");
const bannerRoutes = require("./v1Routes/banner.routes");
const subBrandRoutes = require("./v1Routes/subBrand.routes");
const purchaseReturnRoutes = require("./v1Routes/purchaseReturn.routes");
const districtRoutes = require("./v1Routes/district.routes");
const plantRoutes = require("./v1Routes/plant.routes");
const externalRoutes = require("./v1Routes/external.routes");
const dbBankRoutes = require("./v1Routes/dbBank.route");
const dbUpiRoutes = require("./v1Routes/dbUpi.route");
const distributorTransactionRoutes = require("./v1Routes/distributorTransaction.routes");
const priceCSVRoutes = require("./v1Routes/priceCSV.routes");
const rewardSlabRoutes = require("./v1Routes/rewardSlab.routes");
const retailerTransactionRoutes = require("./v1Routes/retailerMultiplierTransaction.routes");
const helpDeskRoutes = require("./v1Routes/helpDesk.routes");
const primaryTargetRoutes = require("./v1Routes/primaryTarget.routes");
// const secondaryTargetRoutes = require("./v1Routes/secondaryTarget.routes");
const logsRoutes = require("./v1Routes/logs.routes");
const secondaryTargetRoutes = require("./v1Routes/secondaryTarget.routes");
const outletRetailerTransactionRoutes = require("./v1Routes/outletRetailerTransaction.routes");
const retailerLoginRoutes = require("./v1Routes/retailerLogin.routes");
const rbpCatalogueRoutes = require("./v1Routes/rbpCatalogue.routes");
const giftOrderRoutes = require("./v1Routes/giftOrder.route");
const cartRoutes = require("./v1Routes/cart.routes");
const distributorApprovalRoutes = require("./v1Routes/distributorApproval.routes");
const tallyReportRoutes = require("./v1Routes/tallyReport.routes");
const appVersionRoutes = require("./v1Routes/appVersion.routes");
const notificationRoutes = require("./v1Routes/notification.routes");
const configureGiftFlowRoutes = require("./v1Routes/configureGiftFlow.routes");
const rebuildBalanceRoutes = require("./v1Routes/rebuildBalance.routes");

// ============ BILL DELIVERY PORTAL LOCK ROUTES ============
const adminBillDeliveryRoutes = require("./v1Routes/adminBillDelivery.routes");
const distributorBillDeliveryRoutes = require("./v1Routes/distributorBillDelivery.routes");
// ============ END BILL DELIVERY PORTAL LOCK ROUTES ============

// ============ DISTRIBUTOR RLP SETTINGS ROUTES ============
const distributorRLPRoutes = require("./v1Routes/distributorRLP.routes");
// ============ END DISTRIBUTOR RLP SETTINGS ROUTES ============

const v1Routes = express.Router();

v1Routes.use("/ping", async (req, res) => {
  res.status(200).json({
    status: 200,
    message: "v1 Routes are alive!",
  });
});

v1Routes.use("/users", userRoutes);
v1Routes.use("/category", categoryRoutes);
v1Routes.use("/collection", collectionRoutes);
v1Routes.use("/product", productRoutes);
v1Routes.use("/dashboard", dashboardRoutes);
v1Routes.use("/price", priceRoutes);
v1Routes.use("/zone", zoneRoutes);
v1Routes.use("/region", regionRoutes);
v1Routes.use("/state", stateRoutes);
v1Routes.use("/brand", brandRoutes);
v1Routes.use("/bulk", fileUploadRoutes);
v1Routes.use("/cloudinary", cloudinaryRoutes);
v1Routes.use("/password", passwordRoutes);
v1Routes.use("/distributor", distributorRoutes);
v1Routes.use("/designation", designationRoutes);
v1Routes.use("/employee", employeeRoutes);
v1Routes.use("/beat", beatRoutes);
v1Routes.use("/outlet", outletRoutes);
v1Routes.use("/outletApproved", outletApprovedRoutes);
v1Routes.use("/inventory", inventoryRoutes);
v1Routes.use("/transaction", transactionRoutes);
v1Routes.use("/invoice", invoiceRoutes);
v1Routes.use("/transactionDraft", transactionDraftRoutes);
v1Routes.use("/report", reportRouter);
v1Routes.use("/bank", bankRoutes);
v1Routes.use("/branch", branchRoutes);
v1Routes.use("/delivery-boy", deliveryBoyRoutes);
v1Routes.use("/bill-series", billSeriesRoutes);
v1Routes.use("/order-entry", orderEntryRoutes);
v1Routes.use("/reason", reasonRoutes);
v1Routes.use("/bill", billRoutes);
v1Routes.use("/db_rule", dbRuleRoutes);
v1Routes.use("/vehicle", vehicleRoutes);
v1Routes.use("/load-sheet", loadSheetRoutes);
v1Routes.use("/sales-return", salesReturnRoutes);
v1Routes.use("/credit-note", creditNoteRoutes);
v1Routes.use("/replacement", replacementRoutes);
v1Routes.use("/ledger", ledgerRoutes);
v1Routes.use("/ledger-collection", ledgerCollectionRoutes);
v1Routes.use("/supplier", supplierRoutes);
v1Routes.use("/product_norm", productNormsRoutes);
v1Routes.use("/purchase-order", purchaseOrderRoutes);
v1Routes.use("/config", configRoutes);
v1Routes.use("/retailer-tnc", retailerTnCRoutes);
v1Routes.use("/gift-product", giftProductRoutes);
v1Routes.use("/catalogue", catalogueRoutes);
v1Routes.use("/banner", bannerRoutes);
v1Routes.use("/sub-brand", subBrandRoutes);
v1Routes.use("/purchase-return", purchaseReturnRoutes);
v1Routes.use("/district", districtRoutes);
v1Routes.use("/plant", plantRoutes);
v1Routes.use("/external", externalRoutes);
v1Routes.use("/db-bank", dbBankRoutes);
v1Routes.use("/db-upi", dbUpiRoutes);
v1Routes.use("/db-transaction", distributorTransactionRoutes);
v1Routes.use("/price-csv", priceCSVRoutes);
v1Routes.use("/reward-slab", rewardSlabRoutes);
v1Routes.use("/retailerMultiplier", retailerTransactionRoutes);
v1Routes.use("/help-desk", helpDeskRoutes);
v1Routes.use("/primary-target", primaryTargetRoutes);
v1Routes.use("/secondary-target", secondaryTargetRoutes);
v1Routes.use("/logs", logsRoutes);
v1Routes.use("/secondary-target", secondaryTargetRoutes);
v1Routes.use("/outlet-retailer-transaction", outletRetailerTransactionRoutes);
v1Routes.use("/retailer", retailerLoginRoutes);
v1Routes.use("/rbp-catalogue", rbpCatalogueRoutes);
v1Routes.use("/gift-order", giftOrderRoutes);
v1Routes.use("/cart", cartRoutes);
v1Routes.use("/distributor-approval", distributorApprovalRoutes);
v1Routes.use("/tally-report", tallyReportRoutes);
v1Routes.use("/app-version", appVersionRoutes);
v1Routes.use("/notifications", notificationRoutes);
v1Routes.use("/configure-gift-flow", configureGiftFlowRoutes);
v1Routes.use("/rebuild-balance-cron", rebuildBalanceRoutes);


// ============ BILL DELIVERY PORTAL LOCK ROUTES ============
v1Routes.use("/admin", adminBillDeliveryRoutes); // Admin routes: /api/v1/admin/*
v1Routes.use("/distributor", distributorBillDeliveryRoutes); // Distributor routes: /api/v1/distributor/*
// ============ END BILL DELIVERY PORTAL LOCK ROUTES ============

// ============ DISTRIBUTOR RLP SETTINGS ROUTES ============
v1Routes.use("/distributor-rlp", distributorRLPRoutes);
// ============ END DISTRIBUTOR RLP SETTINGS ROUTES ============

module.exports = v1Routes;
