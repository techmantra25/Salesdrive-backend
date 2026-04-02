const express = require("express");
const {
  createDbRule,
  updateDbRule,
  getDbRule,
} = require("../../controllers/dbRule.controller");
const { protect } = require("../../middlewares/auth.middleware.js");
const dbRuleRoutes = express.Router();

dbRuleRoutes.route("/create_db_rule").post(protect, createDbRule);
dbRuleRoutes.route("/update_db_rule/:dbId").patch(protect, updateDbRule);
dbRuleRoutes.route("/get_db_rule/:dbId").get(protect, getDbRule);

module.exports = dbRuleRoutes;
