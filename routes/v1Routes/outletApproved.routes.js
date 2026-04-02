const express = require("express");
const { protectRoute,authorizeRoles, isAdmin } = require("../../middlewares/protectRoute.js");
const {
  getAllReport,
} = require("../../controllers/outletApproved/getAllReport.js");
const {
  outletApprovedList,
} = require("../../controllers/outletApproved/outletApprovedList.js");
const {
  outletAppDetail,
} = require("../../controllers/outletApproved/outletAppDetail.js");
const {
  paginatedOutletApproved,
} = require("../../controllers/outletApproved/paginatedOutletApproved.js");
const {
  activeInactiveOutlet,
} = require("../../controllers/outletApproved/ActiveInactiveOutlet.js");
const {
  outletTransferCopy,
} = require("../../controllers/outletApproved/outletTransferCopy.js");
const {
  outletApprovedBulk,
} = require("../../controllers/outletApproved/outletApprovedBulk.js");
const {
  getOutletByDistributor,getOutletMinimalByDistributor,
  searchOutletsByDistributor,
  getOutletDetailById
} = require("../../controllers/outletApproved/getOutletByDistributor.js");

const {getPaginatedOutletByDistributor} = require("../../controllers/outletApproved/getPaginatedOutletByDistributor.js");


const {
  outletApprovedEdit,
} = require("../../controllers/outletApproved/outletApprovedEdit.js");

const {
  retailerLogin,
} = require("../../controllers/outletApproved/retailerLogin.js");

const {
  changePassword,
} = require("../../controllers/outletApproved/changePassword.js");

const protectRetailerRoute = require("../../middlewares/ptotectReatilerRoute.js");
const { loginRateLimiter } = require("../../middlewares/rateLimiter.js");

const { getMe } = require("../../controllers/outletApproved/getMe.js");
const {
  outletApprovedReport,
} = require("../../controllers/outletApproved/outletApprovedReport.js");

const {
  countOutletsByMobile1,
} = require("../../controllers/outletApproved/checkMultiOutlet.js");

const {
  mergeOutletsWithSameMobile,
} = require("../../controllers/outletApproved/DuplicateRemove.js");

const {
  findOutletsWithPlus91,
  findOutletWithPlus91ById,
  findOutletsWithPlus91AndDuplicates,
  removeAllPlus91Prefixes
} = require("../../controllers/outletApproved/Remove91duplicate.js");

const {
  modifyOutletByCode,
} = require("../../controllers/outletApproved/modifyOutlet.js");
const bulkModifyOutletController = require("../../controllers/outletApproved/BulkModifyOutlet.js");

const { getEmptyMassistRefIds } = require("../../controllers/outletApproved/checkOnOutletApproved.js");

const { disableOutlets } = require("../../controllers/outletApproved/deactiveNullOutlet.js");
const { downloadActiveOutlets } = require("../../controllers/outletApproved/DownloadOutlets.js");
const { paginatedRetailerOutletTransaction } = require("../../controllers/outletRetailerTransaction/paginatedRetailerOutletTransaction.js");
const {addManualPoints} = require("../../controllers/outletApproved/addManualPoints.js");
const kycOutletUpdate = require("../../controllers/outletApproved/KycOutletUpdate.js");
const removeOutletAccount = require("../../controllers/outletApproved/removeOutletAccount.js");
const { bulkOutletModification} = require("../../controllers/outlet/bulkOutletModification.js");
const { mergeOutletPoints } = require("../../controllers/outletApproved/mergeOutletPoints.js");

const {
  getInactiveOutletTransactions,
} = require("../../controllers/outletApproved/getInactiveOutletTransactions.js");

const {
  DateByfetchoutlets,
} = require("../../controllers/external/DateByfetchoutlets.js");

const {
  swapOrderRetailer,
} = require("../../controllers/outletApproved/swapOrderRetailer.js");

const {searchOutletsForDropdown} = require("../../controllers/outletApproved/searchOutletsForDropdown.js")
const cleanCurrentBalance = require("../../controllers/outletApproved/CleanCurrentBalance.js");
const { getOutletDistributors } = require("../../controllers/outletApproved/getOutletDistributors.js");

const outletApprovedRoutes = express.Router();

outletApprovedRoutes.route("/list").get(outletApprovedList); // incorrect
outletApprovedRoutes.route("/transfer-copy").post(outletTransferCopy); // incorrect
outletApprovedRoutes.route("/get-report").get(getAllReport); // incorrect
outletApprovedRoutes
  .route("/bulk-add")
  .post(protectRoute, authorizeRoles(), outletApprovedBulk); // incorrect

outletApprovedRoutes.route("/detail/:outletAppId").get(outletAppDetail);
outletApprovedRoutes
  .route("/outlet-edit/:outletAppId")
  .patch(protectRoute, outletApprovedEdit);

outletApprovedRoutes.route("/paginated-list").get(paginatedOutletApproved);
outletApprovedRoutes.route("/outlet-report").get(outletApprovedReport);

outletApprovedRoutes
  .route("/outlet-by-distributor/:did")
  .get(getOutletByDistributor);

outletApprovedRoutes
  .route("/outlet-by-distributor/minimal/:did")
  .get(getOutletMinimalByDistributor);
outletApprovedRoutes
  .route("/outlet-by-distributor/search/:did")
  .get(searchOutletsByDistributor);
outletApprovedRoutes
  .route("/outlet-by-distributor/detail/:id")
  .get(getOutletDetailById);

outletApprovedRoutes
  .route("/change-password")
  .patch(protectRetailerRoute, changePassword);
outletApprovedRoutes.get("/active-inactive",activeInactiveOutlet);
outletApprovedRoutes.route("/bulk-modify-outlets").post(bulkOutletModification);

outletApprovedRoutes.route("/outlet-by-distributor/:did").get(getOutletByDistributor);
outletApprovedRoutes.route("/paginated-outlet-by-distributor/:did").get(getPaginatedOutletByDistributor);
outletApprovedRoutes.route("/change-password").patch(protectRetailerRoute, changePassword);
outletApprovedRoutes.route("/retailer-login").post(loginRateLimiter, retailerLogin);
outletApprovedRoutes.route("/get-me").get(protectRetailerRoute, getMe);
outletApprovedRoutes.route("/count-mobile1").get(countOutletsByMobile1);
outletApprovedRoutes.route("/merge-outlets-by-mobile").post(mergeOutletsWithSameMobile);

// Route for modifying outlet UID
outletApprovedRoutes.route("/modify-outlet-by-code").post(modifyOutletByCode);

// Route for bulk migration of old outlets to new sourceData schema
outletApprovedRoutes
  .route("/bulk-migrate-old-outlets")
  .post(bulkModifyOutletController.migrateAllOutletsFast);


outletApprovedRoutes.route("/empty-massist-refids").get(getEmptyMassistRefIds);

outletApprovedRoutes.route("/disable-outlets").get(disableOutlets);

// Route for downloading approved outlets as CSV (active or inactive based on query param)
outletApprovedRoutes.route("/download-outlets").get(downloadActiveOutlets);

// Routes for finding outlets with +91 prefix in mobile numbers
outletApprovedRoutes.route("/find-plus91-prefix").get(findOutletsWithPlus91);
outletApprovedRoutes.route("/find-plus91-prefix/:id").get(findOutletWithPlus91ById);

//route to add manual points

outletApprovedRoutes.route("/addManualPoints/:outletId").post(addManualPoints);


outletApprovedRoutes.route("/find-plus91-and-duplicates").get(findOutletsWithPlus91AndDuplicates);
outletApprovedRoutes.route("/remove-all-plus91-prefixes").put(removeAllPlus91Prefixes);

outletApprovedRoutes.route("/count-mobile1").get(countOutletsByMobile1);
outletApprovedRoutes.route("/retailer-transaction-paginated").get(paginatedRetailerOutletTransaction);
outletApprovedRoutes.route("/kyc-update").patch(protectRetailerRoute, kycOutletUpdate);
outletApprovedRoutes.route("/remove-account").delete(protectRetailerRoute, removeOutletAccount);
outletApprovedRoutes.route("/merge-outlet-points/:mobile").get(mergeOutletPoints);

// Routes related to orders with pending bills for inactive outlets
outletApprovedRoutes
  .route("/inactive-outlet-order")
  .get(getInactiveOutletTransactions);
// outletApprovedRoutes
//   .route("/inactive-outlet-order-summary")
//   .get(getPendingBillsSummary);

  outletApprovedRoutes.route("/swap-order-retailer").post(swapOrderRetailer);

//route to search outlets
outletApprovedRoutes.route("/search-dropdown").get(searchOutletsForDropdown);

// Route to clean current balance with admin protection
outletApprovedRoutes.route("/clean-current-balance").post(protectRoute, authorizeRoles(), cleanCurrentBalance);
outletApprovedRoutes.route("/outlet-distributors/:outletId").get( protectRoute, getOutletDistributors);

// Route to fetch outlets by date range from external API
outletApprovedRoutes.route("/fetch-outlets-by-date").get(protectRoute, authorizeRoles(), DateByfetchoutlets);

module.exports = outletApprovedRoutes;
