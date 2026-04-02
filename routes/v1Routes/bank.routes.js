const express = require("express");
const { protectDisRoute } = require("../../middlewares/protectDisRoute.js");
const { protect } = require("../../middlewares/auth.middleware.js");
const { createBank } = require("../../controllers/bank/createBank.js");
const { detailBank } = require("../../controllers/bank/detailBank.js");
const { updateBank } = require("../../controllers/bank/updateBank.js");
const { bankList } = require("../../controllers/bank/listBank.js");

const bankRoutes = express.Router();

bankRoutes.route("/create").post(protectDisRoute, createBank);

bankRoutes.route("/detail/:bankId").get(protect, detailBank);

bankRoutes.route("/update/:bankId").patch(protectDisRoute, updateBank);

bankRoutes.route("/list").get(protect, bankList);

module.exports = bankRoutes;
