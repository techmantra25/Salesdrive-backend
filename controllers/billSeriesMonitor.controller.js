const asyncHandler = require("express-async-handler");
const BillSeriesMonitor = require("../models/billSeriesMonitor");

// Create a new bill series monitor entry
const createBillSeriesMonitor = asyncHandler(async (req, res) => {
  try {
    const { distributorId, issueType, hasIssues, issueMessage } = req.body;

    const monitor = new BillSeriesMonitor({
      distributorId,
      issueType,
      hasIssues,
      issueMessage,
    });

    const savedMonitor = await monitor.save();

    return res.status(201).json({
      status: 201,
      message: "Bill series monitor entry created successfully",
      data: savedMonitor,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get all bill series monitor entries with filters
const getBillSeriesMonitors = asyncHandler(async (req, res) => {
  try {
    const { distributorId, issueType, hasIssues } = req.query;

    const query = {};
    if (distributorId) query.distributorId = distributorId;
    if (issueType) query.issueType = issueType;
    if (hasIssues !== undefined) query.hasIssues = hasIssues === 'true';

    const monitors = await BillSeriesMonitor.find(query)
      .populate({
        path: "distributorId",
        select: "name dbCode",
      })
      .sort({ monitoredAt: -1 });

    return res.status(200).json({
      status: 200,
      message: "Bill series monitor entries retrieved successfully",
      data: monitors,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get bill series monitor entries by distributor ID
const getBillSeriesMonitorsByDistributorId = asyncHandler(async (req, res) => {
  try {
    const { distributorId } = req.params;

    const monitors = await BillSeriesMonitor.find({ distributorId })
      .populate({
        path: "distributorId",
        select: "name dbCode",
      })
      .sort({ monitoredAt: -1 });

    return res.status(200).json({
      status: 200,
      message: "Bill series monitor entries retrieved successfully",
      data: monitors,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Get a single bill series monitor entry by ID
const getBillSeriesMonitorById = asyncHandler(async (req, res) => {
  try {
    const monitor = await BillSeriesMonitor.findById(req.params.id).populate({
      path: "distributorId",
      select: "name dbCode",
    });

    if (!monitor) {
      res.status(404);
      throw new Error("Bill series monitor entry not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Bill series monitor entry retrieved successfully",
      data: monitor,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Update a bill series monitor entry
const updateBillSeriesMonitor = asyncHandler(async (req, res) => {
  try {
    const { issueType, hasIssues, issueMessage } = req.body;

    const monitor = await BillSeriesMonitor.findByIdAndUpdate(
      req.params.id,
      { issueType, hasIssues, issueMessage },
      { new: true }
    ).populate({
      path: "distributorId",
      select: "name dbCode",
    });

    if (!monitor) {
      res.status(404);
      throw new Error("Bill series monitor entry not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Bill series monitor entry updated successfully",
      data: monitor,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// Delete a bill series monitor entry
const deleteBillSeriesMonitor = asyncHandler(async (req, res) => {
  try {
    const monitor = await BillSeriesMonitor.findByIdAndDelete(req.params.id);

    if (!monitor) {
      res.status(404);
      throw new Error("Bill series monitor entry not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Bill series monitor entry deleted successfully",
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createBillSeriesMonitor,
  getBillSeriesMonitors,
  getBillSeriesMonitorsByDistributorId,
  getBillSeriesMonitorById,
  updateBillSeriesMonitor,
  deleteBillSeriesMonitor,
};