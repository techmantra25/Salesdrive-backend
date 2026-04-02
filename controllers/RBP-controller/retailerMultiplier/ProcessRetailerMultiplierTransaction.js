const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const { SERVER_URL } = require("../../../config/server.config");
const { acquireLock, releaseLock } = require("../../../models/lock.model");
const OutletApproved = require("../../../models/outletApproved.model");
const Bill = require("../../../models/bill.model");
const moment = require("moment-timezone");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");

const {
  transactionCode,
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const axios = require("axios");

const ProcessRetailerMultiplierTransaction = asyncHandler(async (req, res) => {
  const lockKey = "process-retailer-multiplier-transaction";

  if (!(await acquireLock(lockKey))) {
    return res.status(400).json({
      status: 400,
      message: "Invoice update is already in progress.",
    });
  }

  try {
    let { month, year, retailerId } = req.body;

    console.log("multiplier running for month and year", month, year);

    // Validate required fields
    const missingFields = ["month", "year", "retailerId"].filter(
      (field) => !req.body[field],
    );
    if (missingFields.length > 0) {
      res.status(400);
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    // Validate month/year
    if (month < 1 || month > 12) {
      res.status(400);
      throw new Error("Invalid month. It should be between 1 and 12.");
    }
    if (year < 2000 || year > new Date().getFullYear()) {
      res.status(400);
      throw new Error(
        "Invalid year. It should be between 2000 and current year.",
      );
    }

    // if month and year is current month and year, return error
    const currentMonth = moment().tz("Asia/Kolkata").month() + 1;
    const currentYear = moment().tz("Asia/Kolkata").year();

    if (month === currentMonth && year === currentYear) {
      res.status(400);
      throw new Error("Cannot process transactions for the current month.");
    }

    // if year is current year and month is greater than current month, return error
    if (year === currentYear && month > currentMonth) {
      res.status(400);
      throw new Error("Cannot process transactions for future months.");
    }

    // Fetch retailer
    const retailer = await OutletApproved.findById(retailerId);
    if (!retailer) {
      res.status(404);
      throw new Error("Retailer not found.");
    }

    // Check if transaction already exists
    const existingTransaction = await RetailerMultiplierTransaction.findOne({
      retailerId: retailer._id,
      month: Number(month),
      year: Number(year),
    });
    const monthName = moment()
      .month(month - 1)
      .format("MMMM");

    if (existingTransaction) {
      res.status(400);
      throw new Error(
        `Multiplier transaction for ${retailer.outletName} (${retailer.outletCode}) for ${monthName}, ${year} already exists.`,
      );
    }

    // Fetch reward slabs
    let rewardSlabs = [];
    try {
      const { data } = await axios.get(
        `${SERVER_URL}/api/v1/reward-slab/get-reward-slabs`,
      );
      rewardSlabs = data?.data || [];
    } catch (error) {
      console.log("Error in fetching reward slabs:", error);
      res.status(500);
      throw new Error("Failed to fetch reward slabs. Please try again later.");
    }

    if (!rewardSlabs.length) {
      res.status(404);
      throw new Error("No reward slabs found.");
    }

    const volumeMultiplierSlab = rewardSlabs.find(
      (slab) => slab.slabType === "Volume Multiplier",
    );
    const consistencyMultiplierSlab = rewardSlabs.find(
      (slab) => slab.slabType === "Consistency Multiplier",
    );
    const billVolumeMultiplierSlab = rewardSlabs.find(
      (slab) => slab.slabType === "Bill Volume Multiplier",
    );

    if (
      !volumeMultiplierSlab &&
      !consistencyMultiplierSlab &&
      !billVolumeMultiplierSlab
    ) {
      res.status(404);
      throw new Error("No applicable reward slabs found for multipliers.");
    }

    // Calculate start/end of month
    const startDate = moment
      .tz({ year, month: month - 1, day: 1 }, "Asia/Kolkata")
      .startOf("day")
      .toDate();

    const endDate = moment(startDate).endOf("month").toDate();

    // Fetch bills & transactions in parallel
    const [bills, dbTransactions, salesReturnDbTransactions, consistency] =
      await Promise.all([
        Bill.find({
          retailerId: retailer._id,
          status: "Delivered",
          "dates.deliveryDate": { $gte: startDate, $lt: endDate },
        }),
        DistributorTransaction.find({
          retailerId: retailer._id,
          transactionType: "debit",
          transactionFor: "SALES",
          createdAt: { $gte: startDate, $lt: endDate },
        }).sort({ createdAt: -1 }),
        DistributorTransaction.find({
          retailerId: retailer._id,
          transactionType: "credit",
          transactionFor: "Sales Return",
          createdAt: { $gte: startDate, $lt: endDate },
        })
          .sort({ createdAt: -1 })
          .populate({
            path: "salesReturnId",
            populate: {
              path: "billId",
            },
          }),
        getRetailersBillMonthConsistency(retailer._id, month, year),
      ]);

    const totalBillAmount = bills.reduce(
      (acc, bill) => acc + (Number(bill?.netAmount) || 0),
      0,
    );

    // get the sales return transactions that have bills delivered in the current month
    const salesReturnDbTransactionsWithThisMonthsBills =
      salesReturnDbTransactions.filter((transaction) => {
        const billMonth = transaction.salesReturnId?.billId?.dates?.deliveryDate
          ? moment(transaction.salesReturnId.billId.dates.deliveryDate)
              .tz("Asia/Kolkata")
              .month() + 1
          : null;

        const billYear = transaction.salesReturnId?.billId?.dates?.deliveryDate
          ? moment(transaction.salesReturnId.billId.dates.deliveryDate)
              .tz("Asia/Kolkata")
              .year()
          : null;

        // const currentMonth = moment().tz("Asia/Kolkata").month() + 1;
        // const currentYear = moment().tz("Asia/Kolkata").year();

        const GRACE_DAYS = 0; // or from env

        const now = moment().tz("Asia/Kolkata");

        // end of previous month + grace
        const prevMonthEndWithGrace = now
          .clone()
          .subtract(1, "month")
          .endOf("month")
          .add(GRACE_DAYS, "days");

        // if today is within grace period → treat as previous month
        const businessMoment = now.isSameOrBefore(prevMonthEndWithGrace)
          ? now.clone().subtract(1, "month")
          : now;

        const currentMonth = businessMoment.month();
        const currentYear = businessMoment.year();
        console.log(
          currentMonth,
          currentYear,
          "currentMonth and currentYear log",
        );
        console.log(billMonth, billYear, "billMonth and billYear");
        if (billMonth === currentMonth && billYear === currentYear) {
          return true;
        } else {
          return false;
        }
      });

    const totalPointsDebit = Number(
      salesReturnDbTransactionsWithThisMonthsBills.reduce(
        (acc, transaction) => acc + (Number(transaction.point) || 0),
        0,
      ),
    );

    const totalPointsCredit = Number(
      dbTransactions.reduce(
        (acc, transaction) => acc + (Number(transaction.point) || 0),
        0,
      ),
    );

    const totalPoints = Number(totalPointsCredit) - Number(totalPointsDebit);

    console.log(
      totalPoints,
      "totalPoints",
      totalPointsCredit,
      "totalPointsCredit",
      totalPointsDebit,
      "totalPointsDebit",
    );

    let volumeMultiplierPoint = 0;
    let volumeMultiplierPercentage = 0;
    let billVolumeMultiplierPoint = 0;
    let billVolumeMultiplierPercentage = 0;
    let consistencyMultiplierPoint = 0;
    let consistencyMultiplierPercentage = 0;

    // Volume Multiplier
    if (
      volumeMultiplierSlab &&
      volumeMultiplierSlab.status?.toLowerCase() === "active" &&
      totalPoints > 0
    ) {
      const applicableSlab = [...volumeMultiplierSlab.slabs]
        .sort((a, b) => Number(b.slabName) - Number(a.slabName))
        .find((slab) => Number(totalPoints) >= Number(slab.slabName));

      volumeMultiplierPercentage = applicableSlab?.percentage || 0;

      if (applicableSlab) {
        volumeMultiplierPoint = Math.round(
          (Number(applicableSlab.percentage) * totalPoints) / 100,
        );
      }
    }

    // Bill Volume Multiplier
    if (
      billVolumeMultiplierSlab &&
      billVolumeMultiplierSlab.status?.toLowerCase() === "active" &&
      totalBillAmount > 0 &&
      totalPoints > 0
    ) {
      const applicableSlab = [...billVolumeMultiplierSlab.slabs]
        .sort((a, b) => Number(b.slabName) - Number(a.slabName))
        .find((slab) => Number(totalBillAmount) >= Number(slab.slabName));

      billVolumeMultiplierPercentage = applicableSlab?.percentage || 0;

      if (applicableSlab) {
        billVolumeMultiplierPoint = Math.round(
          (Number(applicableSlab.percentage) * totalPoints) / 100,
        );
      }
    }

    // Consistency Multiplier
    if (
      consistencyMultiplierSlab &&
      consistencyMultiplierSlab.status?.toLowerCase() === "active" &&
      consistency > 0 &&
      totalPoints > 0
    ) {
      const applicableSlab = consistencyMultiplierSlab.slabs.find(
        (slab) => slab.slabName === `${consistency} Months`,
      );

      consistencyMultiplierPercentage = applicableSlab?.percentage || 0;

      if (applicableSlab) {
        consistencyMultiplierPoint = Math.round(
          (Number(applicableSlab.percentage) * totalPoints) / 100,
        );
      }
    }

    // Save transactions
    const transactionsToSave = [];
    if (volumeMultiplierPoint > 0) {
      const data = {
        retailerId: retailer._id,
        transactionType: "credit",
        transactionFor: "Volume Multiplier",
        point: volumeMultiplierPoint,
        slabPercentage: volumeMultiplierPercentage,
        monthTotalPoints: totalPoints,
        month: Number(month),
        year: Number(year),
        status: "Success",
        remark: `Volume Multiplier for ${monthName}, ${year} based on total points ${totalPoints}`,
      };

      // Create retailer ledger credit for Sales Multiplier
      const lastRetailerTxn = await RetailerOutletTransaction.findOne({
        retailerId: retailer._id,
      }).sort({ createdAt: -1 });
      const prevRetailerBalance = lastRetailerTxn
        ? Number(lastRetailerTxn.balance)
        : Number(retailer.currentPointBalance) || 0;

      const retailerTxn = await RetailerOutletTransaction.create({
        retailerId: retailer._id,
        distributorId: req.user?._id, // optional in this context
        transactionId: await retailerOutletTransactionCode("RTO"),
        transactionType: "credit",
        transactionFor: "Volume Multiplier",
        point: volumeMultiplierPoint,
        balance: prevRetailerBalance + volumeMultiplierPoint,
        status: "Success",
        remark: `Volume Multiplier for ${monthName}, ${year} based on total points ${totalPoints}`,
      });

      // Update snapshot
      await OutletApproved.updateOne(
        { _id: retailer._id },
        { $inc: { currentPointBalance: volumeMultiplierPoint } },
      );

      data.retailerOutletTransactionId = retailerTxn._id;
      transactionsToSave.push(new RetailerMultiplierTransaction(data));
    }
    if (consistencyMultiplierPoint > 0) {
      const data = {
        retailerId: retailer._id,
        transactionType: "credit",
        transactionFor: "Consistency Multiplier",
        point: consistencyMultiplierPoint,
        slabPercentage: consistencyMultiplierPercentage,
        monthTotalPoints: totalPoints,
        month: Number(month),
        year: Number(year),
        status: "Success",
        remark: `Consistency Multiplier for ${monthName}, ${year} based on ${consistency} months consistency and total points ${totalPoints}`,
      };

      const lastRetailerTxn2 = await RetailerOutletTransaction.findOne({
        retailerId: retailer._id,
      }).sort({ createdAt: -1 });
      const prevRetailerBalance2 = lastRetailerTxn2
        ? Number(lastRetailerTxn2.balance)
        : Number(retailer.currentPointBalance) || 0;

      const retailerTxn2 = await RetailerOutletTransaction.create({
        retailerId: retailer._id,
        distributorId: req.user?._id,
        transactionId: await retailerOutletTransactionCode("RTO"),
        transactionType: "credit",
        transactionFor: "Consistency Multiplier",
        point: consistencyMultiplierPoint,
        balance: prevRetailerBalance2 + consistencyMultiplierPoint,
        status: "Success",
        remark: `Consistency Multiplier for ${monthName}, ${year} based on ${consistency} months consistency and total points ${totalPoints}`,
      });

      await OutletApproved.updateOne(
        { _id: retailer._id },
        { $inc: { currentPointBalance: consistencyMultiplierPoint } },
      );

      data.retailerOutletTransactionId = retailerTxn2._id;
      transactionsToSave.push(new RetailerMultiplierTransaction(data));
    }
    if (billVolumeMultiplierPoint > 0) {
      const data = {
        retailerId: retailer._id,
        transactionType: "credit",
        transactionFor: "Bill Volume Multiplier",
        point: billVolumeMultiplierPoint,
        slabPercentage: billVolumeMultiplierPercentage,
        monthTotalPoints: totalPoints,
        month: Number(month),
        year: Number(year),
        status: "Success",
        remark: `Bill Volume Multiplier for ${monthName}, ${year} based on total bill amount ${totalBillAmount} and total points ${totalPoints}`,
      };

      const lastRetailerTxn3 = await RetailerOutletTransaction.findOne({
        retailerId: retailer._id,
      }).sort({ createdAt: -1 });
      const prevRetailerBalance3 = lastRetailerTxn3
        ? Number(lastRetailerTxn3.balance)
        : Number(retailer.currentPointBalance) || 0;

      const retailerTxn3 = await RetailerOutletTransaction.create({
        retailerId: retailer._id,
        distributorId: req.user?._id,
        transactionId: await retailerOutletTransactionCode("RTO"),
        transactionType: "credit",
        transactionFor: "Bill Volume Multiplier",
        point: billVolumeMultiplierPoint,
        balance: prevRetailerBalance3 + billVolumeMultiplierPoint,
        status: "Success",
        remark: `Bill Volume Multiplier for ${monthName}, ${year} based on total bill amount ${totalBillAmount} and total points ${totalPoints}`,
      });

      await OutletApproved.updateOne(
        { _id: retailer._id },
        { $inc: { currentPointBalance: billVolumeMultiplierPoint } },
      );

      data.retailerOutletTransactionId = retailerTxn3._id;
      transactionsToSave.push(new RetailerMultiplierTransaction(data));
    }

    if (transactionsToSave.length === 0) {
      res.status(400);
      throw new Error(
        `No multiplier points to process for for ${retailer.outletName} (${retailer.outletCode}) for ${monthName}, ${year}`,
      );
    }

    if (transactionsToSave.length) {
      await RetailerMultiplierTransaction.insertMany(transactionsToSave);
    }

    return res.status(200).json({
      status: 200,
      message: `Multiplier transactions processed successfully for ${retailer.outletName} (${retailer.outletCode})`,
    });
  } catch (error) {
    console.log("Error in ProcessRetailerMultiplierTransaction", error);
    res.status(500);
    throw error;
  } finally {
    await releaseLock(lockKey);
  }
});

// Optimized consistency check
// const getRetailersBillMonthConsistency = async (retailerId, month, year) => {
//   try {
//     let consistency = 0;
//     for (let i = 0; i < 3; i++) {
//       const start = moment
//         .tz({ year, month: month - 1 - i, day: 1 }, "Asia/Kolkata")
//         .startOf("day")
//         .toDate();
//       const end = moment(start).endOf("month").toDate();

//       const billCount = await Bill.countDocuments({
//         retailerId,
//         status: "Delivered",
//         "dates.deliveryDate": { $gte: start, $lt: end },
//       });

//       if (billCount > 0) {
//         consistency++;
//       } else {
//         break;
//       }
//     }
//     return consistency;
//   } catch (error) {
//     console.error("Error in getRetailersBillMonthConsistency:", error.message);
//     return 0;
//   }
// };

const getRetailersBillMonthConsistency = async (retailerId, month, year) => {
  try {
    let consistency = 0;

    // Base month (1st day of given month)
    const baseMoment = moment
      .tz({ year, month: month - 1, day: 1 }, "Asia/Kolkata")
      .startOf("month");

    for (let i = 0; i < 3; i++) {
      const start = baseMoment
        .clone()
        .subtract(i, "months")
        .startOf("month")
        .toDate();

      const end = baseMoment
        .clone()
        .subtract(i, "months")
        .endOf("month")
        .toDate();

      const billCount = await Bill.countDocuments({
        retailerId,
        status: "Delivered",
        "dates.deliveryDate": { $gte: start, $lt: end },
      });

      if (billCount > 0) {
        consistency++;
      } else {
        break;
      }
    }

    return consistency;
  } catch (error) {
    console.error("Error in getRetailersBillMonthConsistency:", error.message);
    return 0;
  }
};

module.exports = { ProcessRetailerMultiplierTransaction };
