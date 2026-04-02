const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");

const createDistributorTransaction = asyncHandler(async (req, res) => {
  let { distributorId, point, transactionFor, transactionType, Remarks } =
    req.body;

  // Validate required fields
  const requiredFields = [
    "distributorId",
    "point",
    "transactionFor",
    "transactionType",
    "Remarks",
  ];
  const missingFields = requiredFields.filter((field) => !req.body[field]);
  if (missingFields.length > 0) {
    res.status(400);
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }

  // Check if distributor exists
  const distributor = await Distributor.findById(distributorId);
  if (!distributor) {
    res.status(404);
    throw new Error("Distributor not found");
  }

  // **NEW: Check if distributor is mapped to RBP scheme**
  if (distributor.RBPSchemeMapped !== "yes") {
    console.log(
      `Transaction creation denied - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`
    );
    res.status(400);
    throw new Error(
      `Point transaction Denied. Distributor ${distributor.dbCode} is not mapped to RBP scheme. Current RBP Scheme Mapped status: ${distributor.RBPSchemeMapped}`
    );
  }

  console.log(
    `Creating distributor transaction for distributor ${distributor.dbCode} with RBP scheme mapped`
  );

  // Validate point
  point = parseFloat(point);
  if (isNaN(point) || point <= 0) {
    res
      .status(400)
      .throw(new Error("Point must be a valid number and greater than 0"));
  }

  // Validate transactionFor
  const validTransactionFor = [
    "Opening Points",
    "Manual Stock Point",
    "Adjustment Point",
  ];
  if (!validTransactionFor.includes(transactionFor)) {
    res.status(400);
    throw new Error(
      `Invalid transactionFor value. Allowed values are: ${validTransactionFor.join(
        ", "
      )}`
    );
  }

  // Validate transactionType
  const validTransactionType = ["credit", "debit"];
  if (!validTransactionType.includes(transactionType)) {
    res.status(400);
    throw new Error(
      `Invalid transactionType value. Allowed values are: ${validTransactionType.join(
        ", "
      )}`
    );
  }

  // Get latest balance
  const latestTransaction = await DistributorTransaction.findOne({
    distributorId: distributor._id,
  }).sort({ createdAt: -1 });

  let balance = latestTransaction ? Number(latestTransaction.balance) : 0;
  let transactionPoint = Math.round(point); // Keep as number

  let newBalance =
    transactionType === "credit"
      ? balance + transactionPoint
      : balance - transactionPoint;

  // Prevent negative balance on debit
  if (transactionType === "debit" && newBalance < 0) {
    res.status(400);
    throw new Error("Insufficient balance for debit transaction");
  }

  // **UPDATED: Enhanced remark with distributor DB code**
  const enhancedRemark = `${Remarks} for DB Code ${distributor.dbCode}`;

  // Create transaction
  const newTransaction = await DistributorTransaction.create({
    distributorId: distributor._id,
    transactionType,
    transactionFor,
    point: transactionPoint,
    balance: newBalance,
    remark: enhancedRemark,
    status: "Success",
  });

  res.status(201).json({
    message: "Distributor transaction created successfully",
    transaction: newTransaction,
  });
});

module.exports = { createDistributorTransaction };
