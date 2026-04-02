const express = require("express");
const {
  createProduct,
  productDetail,
  updateProduct,
  productAllList,
  productPaginatedList,
} = require("../../controllers/product.controller");
const { protectRoute, isAdmin , authorizeRoles} = require("../../middlewares/protectRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const {
  productListPaginated,
} = require("../../controllers/product/productListPaginated.js");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const {
  getProductByCode,
} = require("../../controllers/product/productByProductCode.js");
const {
  productListPaginatedForPurchaseOrder,
} = require("../../controllers/product/productListPaginatedForPurchaseOrder.js");
const {
  productListPaginatedForCentralPortal,
} = require("../../controllers/product/productListPaginatedForCentralPortal.js");
const protectAdminOrEmployeeRoute = require("../../middlewares/protectAdminOrEmployeeRoute.js");
const {
  getProductByCodeAndDistributor,
} = require("../../controllers/product/productByProcodeAndDis.js");
const {
  downloadProductList,
} = require("../../controllers/product/downloadProductList.js");
const {
  paginatedProductListDms,
  downloadPaginatedProductListDmsCsv,
} = require("../../controllers/product/paginatedProductListDms.js");

// new temporayr route import

const {
  bulkUpdateEanCode,
} = require("../../controllers/product/bulkUpdateEanCode.js");

const productRoutes = express.Router();

productRoutes.route("/create").post(protectRoute,  authorizeRoles(), createProduct);
productRoutes.route("/list").get(protect, productAllList);
productRoutes
  .route("/dis-prod-price-paginated-list")
  .get(protectDisRoute, productListPaginated);
productRoutes
  .route("/dis_prod_price_paginated_list_for_purchase-order")
  .get(protectDisRoute, productListPaginatedForPurchaseOrder);
productRoutes
  .route("/dis_prod_price_paginated_list_for_central-portal")
  .get(protectAdminOrEmployeeRoute, productListPaginatedForCentralPortal);
productRoutes
  .route("/dms-paginated-product-list")
  .get(protectDisRoute, paginatedProductListDms);
productRoutes
  .route("/dms-paginated-product-list-download")
  .get(protectDisRoute, downloadPaginatedProductListDmsCsv);

productRoutes
  .route("/dis-product-by-code/:productCode")
  .get(protectDisRoute, getProductByCode);

productRoutes
  .route("/dis-product-by-code-and-distributor/:productCode/:distributorId")
  .get(getProductByCodeAndDistributor);

productRoutes.route("/detail/:proId").get(protect, productDetail);
productRoutes
  .route("/update/:proId")
  .patch(protectRoute, authorizeRoles(), updateProduct);

productRoutes.route("/product-paginated-list").get(protect, productPaginatedList);
productRoutes.route("/product-download").get(protect, downloadProductList);

// temporary route to upload ean code

productRoutes
  .route("/bulk-update-ean")
  .post(protectRoute, authorizeRoles(), bulkUpdateEanCode);

module.exports = productRoutes;
