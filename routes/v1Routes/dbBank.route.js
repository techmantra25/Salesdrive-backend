const express = require("express");

const { createDbBank } = require("../../controllers/dbBank/createDbBank");
const { detailDbBank} = require("../../controllers/dbBank/detailDbBank");
const { updateDbBank } = require("../../controllers/dbBank/updateDbBank");
const { getBankData } = require("../../controllers/dbBank/getBankData");

const { protectDisRoute } = require("../../middlewares/protectDisRoute");
const { protect } = require("../../middlewares/auth.middleware.js");

const { protectRoute, isAdmin } = require("../../middlewares/protectRoute.js");

const dbBankRoutes = express.Router();

dbBankRoutes.route("/create-db-bank").post(protectDisRoute,createDbBank);
dbBankRoutes.route("/detail-db-bank").get(protect, detailDbBank);
dbBankRoutes.route("/update-db-bank").patch(protectDisRoute,updateDbBank);
dbBankRoutes.route("/get-bank-data").get(protectRoute,isAdmin,getBankData);

module.exports = dbBankRoutes;