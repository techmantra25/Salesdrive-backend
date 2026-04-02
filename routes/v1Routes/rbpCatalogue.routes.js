const express = require("express");
const { createRBPCatalogue } = require("../../controllers/RbpCatalogue/createRBPCatalogue");
const { getRBPCatalogueDetail } = require("../../controllers/RbpCatalogue/detailRBPCatalogue");
const { updateRBPCatalogue } = require("../../controllers/RbpCatalogue/updateRBPCatalogue");
const { deleteRBPCatalogue } = require("../../controllers/RbpCatalogue/deleteRBPCatalogue");
const { listRBPCatalogue } = require("../../controllers/RbpCatalogue/listRBPCatalogue");
const protectAdminOrEmployeeRoute = require("../../middlewares/protectAdminOrEmployeeRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const rbpCatalogueRoutes = express.Router();

rbpCatalogueRoutes.route("/create").post(protectAdminOrEmployeeRoute, createRBPCatalogue);
rbpCatalogueRoutes.route("/list").get(listRBPCatalogue);
rbpCatalogueRoutes.route("/detail/:id").get(protectAdminOrEmployeeRoute, getRBPCatalogueDetail);
rbpCatalogueRoutes.route("/update/:id").patch(protectAdminOrEmployeeRoute, updateRBPCatalogue);
rbpCatalogueRoutes.route("/delete/:id").delete(protectAdminOrEmployeeRoute, deleteRBPCatalogue);

module.exports = rbpCatalogueRoutes;
