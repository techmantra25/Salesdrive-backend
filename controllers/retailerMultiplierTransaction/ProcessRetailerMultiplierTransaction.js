const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");
const { acquireLock, releaseLock } = require("../../models/lock.model");
const OutletApproved = require("../../models/outletApproved.model");
const Bill = require("../../models/bill.model");
const moment = require("moment-timezone");
const RetailerMultiplierTransaction = require("../../models/retailerMultiplierTransaction.model");
const { RBP_POINT_CREDIT_API } = require("../../config/retailerApp.config");

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

    // Validate required fields
    const missingFields = ["month", "year", "retailerId"].filter(
      (field) => !req.body[field]
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
        "Invalid year. It should be between 2000 and current year."
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
        `Multiplier transaction for ${retailer.outletName} (${retailer.outletCode}) for ${monthName}, ${year} already exists.`
      );
    }

    // Fetch reward slabs
    let rewardSlabs = [];
    try {
      const { data } = await axios.get(
        `${SERVER_URL}/api/v1/reward-slab/get-reward-slabs`
      );
      rewardSlabs = data?.data || [];
    } catch (error) {
      res.status(500);
      throw new Error("Failed to fetch reward slabs. Please try again later.");
    }

    if (!rewardSlabs.length) {
      res.status(404);
      throw new Error("No reward slabs found.");
    }

    const volumeMultiplierSlab = rewardSlabs.find(
      (slab) => slab.slabType === "Volume Multiplier"
    );
    const consistencyMultiplierSlab = rewardSlabs.find(
      (slab) => slab.slabType === "Consistency Multiplier"
    );
    const billVolumeMultiplierSlab = rewardSlabs.find(
      (slab) => slab.slabType === "Bill Volume Multiplier"
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

    // Special case: for November 2025, end date should be December 3rd
    let endDate;
    if (month === 11 && year === 2025) {
      // month === 11 in the request means November (1-12 indexed input)
      endDate = moment
        .tz({ year: 2025, month: 11, day: 3 }, "Asia/Kolkata") // December 3rd, 2025 (0-indexed: 11 = December in moment.js)
        .endOf("day")
        .toDate();
    } else {
      endDate = moment(startDate).endOf("month").toDate();
    }

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
      0
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

        const currentMonth = moment().tz("Asia/Kolkata").month() + 1;
        const currentYear = moment().tz("Asia/Kolkata").year();

        if (billMonth === currentMonth && billYear === currentYear) {
          return true;
        } else {
          return false;
        }
      });

    const totalPointsDebit = Number(
      salesReturnDbTransactionsWithThisMonthsBills.reduce(
        (acc, transaction) => acc + (Number(transaction.point) || 0),
        0
      )
    );

    const totalPointsCredit = Number(
      dbTransactions.reduce(
        (acc, transaction) => acc + (Number(transaction.point) || 0),
        0
      )
    );

    const totalPoints = Number(totalPointsCredit) - Number(totalPointsDebit);

    console.log({
      retailerId: retailer._id,
      month,
      year,
      totalBillAmount,
      totalPoints,
      consistency,
    });

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
          (Number(applicableSlab.percentage) * totalPoints) / 100
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
          (Number(applicableSlab.percentage) * totalPoints) / 100
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
        (slab) => slab.slabName === `${consistency} Months`
      );

      consistencyMultiplierPercentage = applicableSlab?.percentage || 0;

      if (applicableSlab) {
        consistencyMultiplierPoint = Math.round(
          (Number(applicableSlab.percentage) * totalPoints) / 100
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
        status: "Pending",
        remark: `Volume Multiplier for ${monthName}, ${year} based on total points ${totalPoints}`,
      };

      const body = {
        outlet_id: retailer.outletUID,
        amount: volumeMultiplierPoint,
        remarks: `Volume Multiplier for ${monthName}, ${year} based total points ${totalPoints}`,
        type: "Sales Multiplier",
        entry_date: moment(existingTransaction?.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_CREDIT_API, body);
        if (earnPointsResponse.data?.error) {
          data.status = "Failed";
          data.apiResponse = earnPointsResponse.data;
        } else {
          data.status = "Success";
        }
      } catch (error) {
        data.status = "Failed";
        data.apiResponse = error?.response?.data || {
          message: "API call failed",
        };
      }

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
        status: "Pending",
        remark: `Consistency Multiplier for ${monthName}, ${year} based on ${consistency} months consistency and total points ${totalPoints}`,
      };

      const body = {
        outlet_id: retailer.outletUID,
        amount: consistencyMultiplierPoint,
        remarks: `Consistency Multiplier for ${monthName}, ${year} based on ${consistency} months consistency and total points ${totalPoints}`,
        type: "Sales Multiplier",
        entry_date: moment(existingTransaction?.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_CREDIT_API, body);
        if (earnPointsResponse.data?.error) {
          data.status = "Failed";
          data.apiResponse = earnPointsResponse.data;
        } else {
          data.status = "Success";
        }
      } catch (error) {
        data.status = "Failed";
        data.apiResponse = error?.response?.data || {
          message: "API call failed",
        };
      }

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
        status: "Pending",
        remark: `Bill Volume Multiplier for ${monthName}, ${year} based on total bill amount ${totalBillAmount} and total points ${totalPoints}`,
      };

      const body = {
        outlet_id: retailer.outletUID,
        amount: billVolumeMultiplierPoint,
        remarks: `Bill Volume Multiplier for ${monthName}, ${year} based on total bill amount ${totalBillAmount} and total points ${totalPoints}`,
        type: "Sales Multiplier",
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_CREDIT_API, body);
        if (earnPointsResponse.data?.error) {
          data.status = "Failed";
          data.apiResponse = earnPointsResponse.data;
        } else {
          data.status = "Success";
        }
      } catch (error) {
        data.status = "Failed";
        data.apiResponse = error?.response?.data || {
          message: "API call failed",
        };
      }

      transactionsToSave.push(new RetailerMultiplierTransaction(data));
    }

    if (transactionsToSave.length === 0) {
      res.status(400);
      throw new Error(
        `No multiplier points to process for for ${retailer.outletName} (${retailer.outletCode}) for ${monthName}, ${year}`
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
    res.status(500);
    throw error;
  } finally {
    await releaseLock(lockKey);
  }
});

// Optimized consistency check
const getRetailersBillMonthConsistency = async (retailerId, month, year) => {
  try {
    let consistency = 0;
    for (let i = 0; i < 3; i++) {
      const start = moment
        .tz({ year, month: month - 1 - i, day: 1 }, "Asia/Kolkata")
        .startOf("day")
        .toDate();
      const end = moment(start).endOf("month").toDate();

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
