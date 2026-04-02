const OutletApproved = require('../../models/outletApproved.model');
const RetailerOutletTransaction = require('../../models/retailerOutletTransaction.model');
const mongoose = require('mongoose');

const cleanCurrentBalance = async (req, res) => {
    try {
        // Find and update all OutletApproved documents where currentPointBalance is not 0, set it to 0
        const result = await OutletApproved.updateMany(
            { currentPointBalance: { $ne: 0 } },
            { $set: { currentPointBalance: 0 } }
        );

        // Return success response with the number of updated documents
        res.status(200).json({
            message: 'Current point balances have been cleaned to 0',
            updatedCount: result.modifiedCount
        });
    } catch (error) {
        // Handle errors
        res.status(500).json({ error: error.message });
    }
};

/**
 * Rebuild outlet approved current point balance without changing timestamp
 */
const rebuildCurrentBalance = async (req, res) => {
    const { outletId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(outletId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid outletId",
        });
    }

    console.log("🔥 Rebuilding current point balance for outletId:", outletId);

    // 1️⃣ Fetch all successful transactions in chronological order
    const transactions = await RetailerOutletTransaction.find({
        retailerId: outletId,
        status: "Success",
    }).sort({ createdAt: 1, _id: 1 });

    if (!transactions.length) {
        return res.status(200).json({
            success: true,
            message: "No transactions found to rebuild balance",
            outletId,
        });
    }

    let runningBalance = 0;

    // 2️⃣ Recalculate balance sequentially
    for (const txn of transactions) {
        if (txn.transactionType === "credit") {
            runningBalance += txn.point;
        } else if (txn.transactionType === "debit") {
            runningBalance -= txn.point;
        }
    }

    // 3️⃣ Update currentPointBalance without changing timestamps
    await OutletApproved.updateOne(
        { _id: outletId },
        { $set: { currentPointBalance: runningBalance } }
    );

    return res.status(200).json({
        success: true,
        message: "Current point balance rebuilt successfully",
        outletId,
        totalTransactions: transactions.length,
        finalBalance: runningBalance,
    });
};

module.exports = cleanCurrentBalance;
module.exports.rebuildCurrentBalance = rebuildCurrentBalance;