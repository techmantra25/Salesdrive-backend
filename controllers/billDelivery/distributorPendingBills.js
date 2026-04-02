const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Distributor = require("../../models/distributor.model");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const moment = require("moment-timezone");

const APP_TIMEZONE = "Asia/Kolkata";

const getPendingBills = asyncHandler(async (req, res) => {
  const distributorId = req.user._id;

  // Find all pending bills for this distributor
  const pendingBills = await Bill.find({
    distributorId,
    status: { $in: ["Pending", "Vehicle Allocated", "Partially-Delivered"] },
  })
    .populate("retailerId", "outletCode outletName mobile1")
    .populate("orderId", "orderNo")
    .select(
      "billNo invoiceAmount status createdAt dates billRemark retailerId orderId",
    )
    .sort({ createdAt: 1 }); // Oldest first

  // Get delivery setting for this distributor
  const deliverySetting = await BillDeliverySetting.findOne({
    distributorId,
    isActive: true,
  });

  // Calculate deadline for each bill
  const billsWithDeadlines = pendingBills.map((bill) => {
    let deliveryDeadline = null;
    let isOverdue = false;
    let remainingDays = null;

    if (deliverySetting) {
      const deadlineMoment = moment(bill.createdAt)
        .tz(APP_TIMEZONE)
        .add(deliverySetting.deliveryDurationDays, "days")
        .startOf("day");

      deliveryDeadline = deadlineMoment.endOf("day").toDate();

      const nowDay = moment().tz(APP_TIMEZONE).startOf("day");
      remainingDays = deadlineMoment.diff(nowDay, "days");
      isOverdue = remainingDays < 0;
    }

    return {
      ...bill.toObject(),
      deliveryDeadline,
      isOverdue,
      remainingDays,
      overdueBy: isOverdue ? Math.abs(remainingDays) : 0,
    };
  });

  // Updated: remainingDays <= 0 are overdue, > 0 are upcoming
  const overdueBills = billsWithDeadlines.filter((b) => b.remainingDays <= 0);
  const upcomingBills = billsWithDeadlines.filter((b) => b.remainingDays > 0);

  res.status(200).json({
    error: false,
    data: {
      overdueBills,
      upcomingBills,
      totalPending: billsWithDeadlines.length,
      totalOverdue: overdueBills.length,
      deliveryDurationDays: deliverySetting?.deliveryDurationDays || null,
    },
  });
});

const getPortalStatus = asyncHandler(async (req, res) => {
  const distributorId = req.user._id;

  const distributor = await Distributor.findById(distributorId)
    .select(
      "isPortalLocked portalLockReason portalLockedAt portalLockedBy pendingBillDeliveries",
    )
    .populate("pendingBillDeliveries.billId", "billNo invoiceAmount status");

  if (!distributor) {
    return res.status(404).json({
      error: true,
      message: "Distributor not found",
    });
  }

  res.status(200).json({
    error: false,
    data: {
      isPortalLocked: distributor.isPortalLocked,
      portalLockReason: distributor.portalLockReason,
      portalLockedAt: distributor.portalLockedAt,
      portalLockedBy: distributor.portalLockedBy,
      pendingBillDeliveries: distributor.pendingBillDeliveries,
    },
  });
});

const getOverdueBillsCount = asyncHandler(async (req, res) => {
  const distributorId = req.user._id;

  // Get delivery setting
  const deliverySetting = await BillDeliverySetting.findOne({
    distributorId,
    isActive: true,
  });

  if (!deliverySetting) {
    return res.status(200).json({
      error: false,
      data: {
        overdueCount: 0,
        message: "No delivery duration set for this distributor",
      },
    });
  }

  // Find pending bills
  const pendingBills = await Bill.find({
    distributorId,
    status: { $in: ["Pending", "Vehicle Allocated", "Partially-Delivered"] },
  }).select("createdAt");

  // Calculate overdue bills
  const nowDay = moment().tz(APP_TIMEZONE).startOf("day");
  let overdueCount = 0;

  pendingBills.forEach((bill) => {
    const deliveryDeadlineDay = moment(bill.createdAt)
      .tz(APP_TIMEZONE)
      .add(deliverySetting.deliveryDurationDays, "days")
      .startOf("day");

    if (nowDay.isAfter(deliveryDeadlineDay)) {
      overdueCount++;
    }
  });

  res.status(200).json({
    error: false,
    data: {
      overdueCount,
      totalPending: pendingBills.length,
      deliveryDurationDays: deliverySetting.deliveryDurationDays,
    },
  });
});

module.exports = {
  getPendingBills,
  getPortalStatus,
  getOverdueBillsCount,
};
