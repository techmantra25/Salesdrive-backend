const asyncHandler = require("express-async-handler");
const ReportRequest = require("../../models/reportRequest.model");
const { inventoryReportUtil } = require("../reportsUtils/inventoryReport");
const { transactionReportUtil } = require("../reportsUtils/transactionReport");
const {
  openingStockReportUtil,
} = require("../reportsUtils/openingStockReport");

const { orderEntryReportUtil } = require("../reportsUtils/orderEntryReport");

const reportRequest = asyncHandler(async (req, res) => {
  try {
    const query = req?.query;
    const body = req?.body;
    const user = req?.user;

    const request = await ReportRequest.create({
      code: `REPORT-${new Date().getTime()}`,
      type: query?.type,
      status: "Pending",
      reqBy: user?._id,
    });

    if (query?.type === "Inventory") {
      inventoryReportUtil(query, body, user, request?._id);
    }

    if (query?.type === "Stock-Adjustment") {
      transactionReportUtil(query, body, user, request?._id);
    }

    if (query?.type === "Opening-Stock") {
      openingStockReportUtil(query, body, user, request?._id);
    }

    if (query?.type === "order-entry") {
      orderEntryReportUtil(query, body, user, request?._id);
    }

    return res.status(200).json({
      status: 200,
      message: "Report request created successfully",
      data: request,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { reportRequest };
