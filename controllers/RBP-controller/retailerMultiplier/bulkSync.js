// const asyncHandler = require("express-async-handler");
// const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
// const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
// const OutletApproved = require("../../../models/outletApproved.model");
// const {
//   retailerOutletTransactionCode,
// } = require("../../../utils/codeGenerator");

// const bulkSyncRetailerMultiplierTransactions = asyncHandler(
//   async (req, res) => {
//     const { dryRun = false } = req.body;

//     // 1️⃣ Fetch ALL success multiplier txns without outlet linkage
//     const multiplierTxns = await RetailerMultiplierTransaction.find({
//       status: "Success",
//       retailerOutletTransactionId: { $exists: false },
//     }).sort({ createdAt: 1 }); // chronological is CRITICAL

//     if (!multiplierTxns.length) {
//       return res.status(200).json({
//         status: 200,
//         message: "No pending retailer multiplier transactions found",
//         summary: {
//           total: 0,
//           created: 0,
//           skipped: 0,
//         },
//       });
//     }

//     let created = 0;
//     let skipped = 0;
//     const errors = [];

//     for (const txn of multiplierTxns) {
//       try {
//         // 2️⃣ Fetch retailer
//         const retailer = await OutletApproved.findById(txn.retailerId);
//         if (!retailer) {
//           skipped++;
//           continue;
//         }

//         // 3️⃣ Get last retailer outlet txn
//         const lastRetailerTxn = await RetailerOutletTransaction.findOne({
//           retailerId: txn.retailerId,
//         }).sort({ createdAt: -1 });

//         const prevBalance = lastRetailerTxn
//           ? Number(lastRetailerTxn.balance)
//           : Number(retailer.currentPointBalance) || 0;

//         const newBalance = prevBalance + Number(txn.point);

//         if (dryRun) {
//           created++;
//           continue;
//         }

//         // 4️⃣ Determine transaction type
//         let transactionType = "credit";
//         if (txn.transactionFor === "Sales Return") {
//           transactionType = "debit";
//         }

//         // 5️⃣ Create retailer outlet transaction
//         const retailerOutletTxn = new RetailerOutletTransaction({
//           retailerId: txn.retailerId,
//           transactionId: await retailerOutletTransactionCode("RTO"),
//           transactionType: transactionType,
//           transactionFor: normalizeTransactionFor(txn.transactionFor),
//           point: Number(txn.point),
//           balance: newBalance,
//           status: "Success",
//           remark: txn.remark,
//           createdAt: txn.createdAt,
//           updatedAt: txn.updatedAt,
//         });

//         // 🔒 Preserve timestamps
//         retailerOutletTxn.$timestamps(false);
//         await retailerOutletTxn.save();

//         // 5️⃣ Update retailer snapshot balance
//         await OutletApproved.updateOne(
//           { _id: txn.retailerId },
//           { $set: { currentPointBalance: newBalance } },
//           { timestamps: false }, // ⛔ do not update updatedAt
//         );

//         // 6️⃣ Link multiplier → outlet txn
//         txn.retailerOutletTransactionId = retailerOutletTxn._id;
//         await txn.save({ timestamps: false });

//         created++;
//       } catch (err) {
//         skipped++;
//         errors.push({
//           multiplierTransactionId: txn._id,
//           error: err.message,
//         });
//       }
//     }

//     return res.status(200).json({
//       status: 200,
//       message: dryRun
//         ? "Dry run completed successfully"
//         : "Retailer multiplier transactions synced successfully",
//       summary: {
//         total: multiplierTxns.length,
//         created,
//         skipped,
//         errors: errors.length,
//       },
//       errors,
//     });
//   },
// );

// // 🔐 Enum safety and mapping for outlet transaction
// function normalizeTransactionFor(value) {
//   if (value === "Sales Return") {
//     return "Multiplier Sales Return";
//   }
//   // For other values, return as is (assuming valid for RetailerOutletTransaction)
//   return value;
// }

// module.exports = bulkSyncRetailerMultiplierTransactions;

const asyncHandler = require("express-async-handler");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const bulkSyncRetailerMultiplierTransactions = asyncHandler(
  async (req, res) => {
    const { dryRun = false } = req.body;

    // 1️⃣ Fetch all SUCCESS multiplier txns not yet synced
    const multiplierTxns = await RetailerMultiplierTransaction.find({
      status: "Success",
      retailerOutletTransactionId: { $exists: false },
    }).sort({ createdAt: 1, _id: 1 }); // 🔥 deterministic order

    if (!multiplierTxns.length) {
      return res.status(200).json({
        status: 200,
        message: "No pending retailer multiplier transactions found",
        summary: { total: 0, created: 0, skipped: 0 },
      });
    }

    let created = 0;
    let skipped = 0;
    const errors = [];

    // 🧠 In-memory running balance per retailer
    const retailerBalanceMap = new Map();

    for (const txn of multiplierTxns) {
      try {
        const retailerId = txn.retailerId.toString();

        // 2️⃣ Load retailer once
        const retailer = await OutletApproved.findById(txn.retailerId);
        if (!retailer) {
          skipped++;
          continue;
        }

        // 3️⃣ Initialize balance ONLY ONCE per retailer
        if (!retailerBalanceMap.has(retailerId)) {
          const lastTxn = await RetailerOutletTransaction.findOne({
            retailerId: txn.retailerId,
          }).sort({ createdAt: -1, _id: -1 });

          const baseBalance = lastTxn
            ? Number(lastTxn.balance)
            : Number(retailer.currentPointBalance) || 0;

          retailerBalanceMap.set(retailerId, baseBalance);
        }

        const prevBalance = retailerBalanceMap.get(retailerId);
        const newBalance = prevBalance + Number(txn.point);

        // 🔁 Update memory immediately
        retailerBalanceMap.set(retailerId, newBalance);

        if (dryRun) {
          created++;
          continue;
        }

        // 4️⃣ Transaction type
        const transactionType =
          txn.transactionFor === "Sales Return" ? "debit" : "credit";

        // 5️⃣ Create outlet transaction
        const retailerOutletTxn = new RetailerOutletTransaction({
          retailerId: txn.retailerId,
          transactionId: await retailerOutletTransactionCode("RTO"),
          transactionType,
          transactionFor: normalizeTransactionFor(txn.transactionFor),
          point: Number(txn.point),
          balance: newBalance,
          status: "Success",
          remark: txn.remark,
          createdAt: txn.createdAt,
          updatedAt: txn.updatedAt,
        });

        // 🔒 Preserve original timestamps
        retailerOutletTxn.$timestamps(false);
        await retailerOutletTxn.save();

        // 6️⃣ Update retailer snapshot balance (no updatedAt)
        await OutletApproved.updateOne(
          { _id: txn.retailerId },
          { $set: { currentPointBalance: newBalance } },
          { timestamps: false }
        );

        // 7️⃣ Link multiplier → outlet txn
        txn.retailerOutletTransactionId = retailerOutletTxn._id;
        await txn.save({ timestamps: false });

        created++;
      } catch (err) {
        skipped++;
        errors.push({
          multiplierTransactionId: txn._id,
          error: err.message,
        });
      }
    }

    return res.status(200).json({
      status: 200,
      message: dryRun
        ? "Dry run completed successfully"
        : "Retailer multiplier transactions synced successfully",
      summary: {
        total: multiplierTxns.length,
        created,
        skipped,
        errors: errors.length,
      },
      errors,
    });
  }
);

// 🔐 Enum mapping safety
function normalizeTransactionFor(value) {
  if (value === "Sales Return") {
    return "Multiplier Sales Return";
  }
  return value;
}

module.exports = bulkSyncRetailerMultiplierTransactions;
