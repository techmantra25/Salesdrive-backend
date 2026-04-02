// const asyncHandler = require("express-async-handler");
// const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
// const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
// const OutletApproved = require("../../../models/outletApproved.model");
// const {
//   retailerOutletTransactionCode,
// } = require("../../../utils/codeGenerator");

// const updateRetailerMultiplierTransaction = asyncHandler(async (req, res) => {
//   try {
//     const { transactionId } = req.params;

//     if (!transactionId) {
//       return res.status(400).json({
//         status: 400,
//         message: "Invalid transactionId",
//       });
//     }

//     // 1️⃣ Find successful multiplier transaction
//     const multiplierTxn = await RetailerMultiplierTransaction.findOne({
//       _id: transactionId,
//       status: "Success",
//     });

//     if (!multiplierTxn) {
//       return res.status(404).json({
//         status: 404,
//         message: "Retailer multiplier transaction not found",
//       });
//     }

//     // 2️⃣ If already linked → return
//     if (multiplierTxn.retailerOutletTransactionId) {
//       const existingRetailerTxn = await RetailerOutletTransaction.findById(
//         multiplierTxn.retailerOutletTransactionId,
//       );

//       return res.status(200).json({
//         status: 200,
//         message: "Retailer outlet transaction already exists",
//         data: {
//           multiplierTransaction: multiplierTxn,
//           retailerOutletTransaction: existingRetailerTxn,
//         },
//       });
//     }

//     // 3️⃣ Fetch retailer
//     const retailer = await OutletApproved.findById(
//       multiplierTxn.retailerId,
//     ).lean();

//     if (!retailer) {
//       return res.status(404).json({
//         status: 404,
//         message: "Retailer not found",
//       });
//     }

//     // 4️⃣ Get last retailer outlet transaction
//     const lastRetailerTxn = await RetailerOutletTransaction.findOne({
//       retailerId: multiplierTxn.retailerId,
//     }).sort({ createdAt: -1 });

//     // 5️⃣ Calculate balance
//     const prevBalance = lastRetailerTxn
//       ? Number(lastRetailerTxn.balance)
//       : Number(retailer.currentPointBalance) || 0;

//     const newBalance = prevBalance + Number(multiplierTxn.point);

//     // 6️⃣ Generate retailer transaction code
//     const retailerTxnCode = await retailerOutletTransactionCode("RTO");

//     if (!retailerTxnCode) {
//       return res.status(500).json({
//         status: 500,
//         message: "Failed to generate retailer transaction code",
//       });
//     }

//     // 6️⃣ Determine transactionFor for outlet transaction
//     let outletTransactionFor = multiplierTxn.transactionFor;
//     let transactionType = "credit";
//     if (multiplierTxn.transactionFor === "Sales Return") {
//       outletTransactionFor = "Multiplier Sales Return";
//       transactionType = "debit";
//     }

//     // 7️⃣ Create RetailerOutletTransaction (timestamps preserved)
//     const retailerOutletTxn = new RetailerOutletTransaction({
//       retailerId: multiplierTxn.retailerId,
//       transactionId: retailerTxnCode,
//       transactionType: transactionType,
//       transactionFor: outletTransactionFor,
//       point: Number(multiplierTxn.point),
//       balance: newBalance,
//       status: "Success",
//       remark: multiplierTxn.remark,
//       createdAt: multiplierTxn.createdAt,
//       updatedAt: multiplierTxn.updatedAt,
//     });

//     // 🔒 Disable auto timestamps
//     // retailerOutletTxn.$timestamps(false);
//     // await retailerOutletTxn.save();

//     // 8️⃣ Update retailer current balance
//     await OutletApproved.findByIdAndUpdate(
//       multiplierTxn.retailerId,
//       {
//         currentPointBalance: newBalance,
//       },
//       {
//         timestamps: false, // ⛔ prevent updatedAt from changing
//       },
//     );

//     // 9️⃣ Link multiplier → retailer outlet txn WITHOUT touching dates
//     multiplierTxn.retailerOutletTransactionId = retailerOutletTxn._id;
//     await multiplierTxn.save({ timestamps: false });

//     // 🔟 Final response
//     return res.status(200).json({
//       status: 200,
//       message: "Retailer multiplier transaction updated successfully",
//       data: {
//         multiplierTransaction: multiplierTxn,
//         retailerOutletTransaction: retailerOutletTxn,
//       },
//     });
//   } catch (error) {
//     console.error("Error updating retailer multiplier transaction:", error);
//     return res.status(500).json({
//       status: 500,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// });

// module.exports = updateRetailerMultiplierTransaction;


const asyncHandler = require("express-async-handler");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const updateRetailerMultiplierTransaction = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;

  if (!transactionId) {
    return res.status(400).json({
      status: 400,
      message: "Invalid transactionId",
    });
  }

  // 1️⃣ Find multiplier transaction
  const multiplierTxn = await RetailerMultiplierTransaction.findOne({
    _id: transactionId,
    status: "Success",
  });

  if (!multiplierTxn) {
    return res.status(404).json({
      status: 404,
      message: "Retailer multiplier transaction not found",
    });
  }

  // 2️⃣ Already synced → return safely
  if (multiplierTxn.retailerOutletTransactionId) {
    const existingRetailerTxn =
      await RetailerOutletTransaction.findById(
        multiplierTxn.retailerOutletTransactionId,
      );

    return res.status(200).json({
      status: 200,
      message: "Retailer outlet transaction already exists",
      data: {
        multiplierTransaction: multiplierTxn,
        retailerOutletTransaction: existingRetailerTxn,
      },
    });
  }

  // 3️⃣ Fetch retailer
  const retailer = await OutletApproved.findById(
    multiplierTxn.retailerId,
  ).lean();

  if (!retailer) {
    return res.status(404).json({
      status: 404,
      message: "Retailer not found",
    });
  }

  // 4️⃣ Get last outlet txn (deterministic)
  const lastRetailerTxn = await RetailerOutletTransaction.findOne({
    retailerId: multiplierTxn.retailerId,
  }).sort({ createdAt: -1, _id: -1 });

  // 5️⃣ Calculate balance
  const prevBalance = lastRetailerTxn
    ? Number(lastRetailerTxn.balance)
    : Number(retailer.currentPointBalance) || 0;

  const newBalance = prevBalance + Number(multiplierTxn.point);

  // 6️⃣ Generate transaction code
  const retailerTxnCode = await retailerOutletTransactionCode("RTO");

  // 7️⃣ Determine outlet txn type
  const transactionType =
    multiplierTxn.transactionFor === "Sales Return" ? "debit" : "credit";

  const outletTransactionFor =
    multiplierTxn.transactionFor === "Sales Return"
      ? "Multiplier Sales Return"
      : multiplierTxn.transactionFor;

  // 8️⃣ Create & SAVE outlet transaction
  const retailerOutletTxn = new RetailerOutletTransaction({
    retailerId: multiplierTxn.retailerId,
    transactionId: retailerTxnCode,
    transactionType,
    transactionFor: outletTransactionFor,
    point: Number(multiplierTxn.point),
    balance: newBalance,
    status: "Success",
    remark: multiplierTxn.remark,
    createdAt: multiplierTxn.createdAt,
    updatedAt: multiplierTxn.updatedAt,
  });

  // 🔒 Preserve original timestamps
  retailerOutletTxn.$timestamps(false);
  await retailerOutletTxn.save();

  // 9️⃣ Update retailer balance snapshot (NO updatedAt)
  await OutletApproved.updateOne(
    { _id: multiplierTxn.retailerId },
    { $set: { currentPointBalance: newBalance } },
    { timestamps: false },
  );

  // 🔟 Link multiplier → outlet txn
  multiplierTxn.retailerOutletTransactionId = retailerOutletTxn._id;
  await multiplierTxn.save({ timestamps: false });

  return res.status(200).json({
    status: 200,
    message: "Retailer multiplier transaction updated successfully",
    data: {
      multiplierTransaction: multiplierTxn,
      retailerOutletTransaction: retailerOutletTxn,
    },
  });
});

module.exports = updateRetailerMultiplierTransaction;
