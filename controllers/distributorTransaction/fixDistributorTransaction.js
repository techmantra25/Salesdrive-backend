const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Distributor = require("../../models/distributor.model");

const fixDistributorTransaction = asyncHandler(async (req, res) => {
  try {
    const { distributorId, transactionType, point, remark } = req.body;

    const requiredFields = [
      "distributorId",
      "transactionType",
      "point",
      "remark",
    ];
    const missingFields = requiredFields.filter((field) => !req.body[field]);
    if (missingFields.length > 0) {
      res.status(400);
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    if (transactionType !== "credit" && transactionType !== "debit") {
      res.status(400);
      throw new Error("Invalid transaction type. Must be 'credit' or 'debit'.");
    }

    if (isNaN(point) || point <= 0) {
      res.status(400);
      throw new Error("Point must be a positive number.");
    }

    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      res.status(404);
      throw new Error(`Distributor with ID ${distributorId} not found`);
    }

    // **NEW: Check if distributor is mapped to RBP scheme**
  if (distributor.RBPSchemeMapped !== "yes") {
    console.log(
      `Transaction creation denied - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`
    );
    res.status(400);
    throw new Error(
      `Distributor ${distributor.dbCode} is not mapped to RBP scheme. Current RBP Scheme Mapped status: ${distributor.RBPSchemeMapped}`
    );
  }


    const latestTransaction = await DistributorTransaction.findOne({
      distributorId,
    }).sort({ createdAt: -1 });

    let balance = 0;

    if (latestTransaction) {
      if (transactionType === "credit") {
        balance = latestTransaction.balance + Number(point);
      } else if (transactionType === "debit") {
        balance = latestTransaction.balance - Number(point);
      }
    } else {
      if (transactionType === "credit") {
        balance = Number(point);
      } else if (transactionType === "debit") {
        balance = -Number(point);
      }
    }

    const newTransaction = new DistributorTransaction({
      distributorId,
      transactionType,
      transactionFor: "other",
      point: Number(point),
      balance: balance,
      status: "Success",
      remark: remark,
    });

    const fixedTransaction = await newTransaction.save();

    res.status(201).json({
      status: 201,
      message: "Distributor transaction fixed successfully",
      data: fixedTransaction,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { fixDistributorTransaction };
