const express = require("express");
const {
  createHelpDesk,
} = require("../../controllers/helpDesk/createHelpDesk.js");
const { helpDeskList } = require("../../controllers/helpDesk/helpDeskList.js");
const {
  helpDeskDetail,
} = require("../../controllers/helpDesk/helpDeskDetail.js");
const {
  deleteHelpDesk,
} = require("../../controllers/helpDesk/deleteHelpDesk.js");
const {
  updateHelpDesk,
} = require("../../controllers/helpDesk/updateHelpDesk.js");
const { protect } = require("../../middlewares/auth.middleware.js");

const helpDeskRoutes = express.Router();
helpDeskRoutes.route("/create-help-desk").post(protect, createHelpDesk);
helpDeskRoutes.route("/help-desk-list").get(protect, helpDeskList);
helpDeskRoutes.route("/help-desk-detail/:id").get(protect, helpDeskDetail);
helpDeskRoutes.route("/delete-help-desk/:id").delete(protect, deleteHelpDesk);
helpDeskRoutes.route("/update-help-desk/:id").patch(protect, updateHelpDesk);

module.exports = helpDeskRoutes;
