const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const updateDistributorTransaction = asyncHandler(async (req, res) => {
  console.log("Updating distributor transaction..ncgvncghn.");
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({
        status: 400,
        message: "Invalid transactionId",
      });
    }

    /* =====================================================
    EDIT MODE — NO TIMESTAMP UPDATE
===================================================== */
if (req.body && Object.keys(req.body).length > 0) {
  const {
    transactionType,
    transactionFor,
    point,
    remark,
    distributorId,
    retailerId,
    createdAt,
    updatedAt,
  } = req.body;

  const distributorTransaction =
    await DistributorTransaction.findById(transactionId);

  if (!distributorTransaction) {
    return res.status(404).json({
      status: 404,
      message: "Distributor transaction not found",
    });
  }

  // 🔒 HARD LOCKS
  if (
    distributorId &&
    distributorId.toString() !==
      distributorTransaction.distributorId.toString()
  ) {
    return res.status(400).json({
      status: 400,
      message: "Distributor cannot be changed",
    });
  }

  if (
    retailerId &&
    retailerId.toString() !==
      distributorTransaction.retailerId.toString()
  ) {
    return res.status(400).json({
      status: 400,
      message: "Retailer cannot be changed",
    });
  }

  // =============================
  // UPDATE DISTRIBUTOR TXN
  // =============================
  if (transactionType)
    distributorTransaction.transactionType = transactionType;

  if (transactionFor)
    distributorTransaction.transactionFor = transactionFor;

  if (point !== undefined)
    distributorTransaction.point = Number(point);

  if (remark !== undefined)
    distributorTransaction.remark = remark;

  distributorTransaction.isEdited = true;

  // Save without timestamps first
  await distributorTransaction.save({ timestamps: false });

  // Then manually update timestamps using findByIdAndUpdate with strict: false
  // This bypasses Mongoose's createdAt immutability protection
  if (createdAt || updatedAt) {
    const updateData = {};
    if (createdAt) updateData.createdAt = new Date(createdAt);
    if (updatedAt) updateData.updatedAt = new Date(updatedAt);

    await DistributorTransaction.findByIdAndUpdate(
      transactionId,
      updateData,
      { 
        timestamps: false,
        strict: false // Allows updating protected fields like createdAt
      }
    );
  }

  // =============================
  // UPDATE RETAILER TXN (IF EXISTS)
  // =============================
  if (distributorTransaction.retailerOutletTransactionId) {
    const retailerTxn = await RetailerOutletTransaction.findById(
      distributorTransaction.retailerOutletTransactionId
    );

    if (retailerTxn) {
      // 🔁 reverse transaction type
      const reversedType =
        distributorTransaction.transactionType === "credit"
          ? "debit"
          : "credit";

      // 🔄 get previous retailer balance
      const prevRetailerTxn = await RetailerOutletTransaction.findOne({
        retailerId: retailerTxn.retailerId,
        createdAt: { $lt: retailerTxn.createdAt },
      }).sort({ createdAt: -1 });

      const previousBalance = prevRetailerTxn
        ? Number(prevRetailerTxn.balance)
        : 0;

      const newBalance =
        reversedType === "credit"
          ? previousBalance + Number(distributorTransaction.point)
          : previousBalance - Number(distributorTransaction.point);

      retailerTxn.transactionType = reversedType;
      retailerTxn.transactionFor = distributorTransaction.transactionFor;
      retailerTxn.point = Number(distributorTransaction.point);
      retailerTxn.balance = newBalance;
      retailerTxn.remark = distributorTransaction.remark;

      // 🔒 NO TIMESTAMP UPDATE ON SAVE
      await retailerTxn.save({ timestamps: false });

      // Sync timestamps if provided using strict: false
      if (createdAt || updatedAt) {
        const retailerUpdateData = {};
        if (createdAt) retailerUpdateData.createdAt = new Date(createdAt);
        if (updatedAt) retailerUpdateData.updatedAt = new Date(updatedAt);

        await RetailerOutletTransaction.findByIdAndUpdate(
          retailerTxn._id,
          retailerUpdateData,
          {
            timestamps: false,
            strict: false
          }
        );
      }
    }
  }

  return res.status(200).json({
    status: 200,
    message: "Distributor & retailer transactions edited successfully",
    data: distributorTransaction,
  });
}


    /* =====================================================
       🔁 RETRY / SYNC MODE — UNCHANGED
    ===================================================== */

    const distributorTransaction = await DistributorTransaction.findOne({
      _id: transactionId,
      status: "Success",
    });

    if (!distributorTransaction) {
      return res.status(404).json({
        status: 404,
        message: "Distributor transaction not found",
      });
    }

    let retailerOutletTransaction = null;

    if (distributorTransaction.retailerOutletTransactionId) {
      retailerOutletTransaction = await RetailerOutletTransaction.findById(
        distributorTransaction.retailerOutletTransactionId
      );

      return res.status(200).json({
        status: 200,
        message: "Retailer outlet transaction already exists",
        data: {
          distributorTransaction,
          retailerOutletTransaction,
        },
      });
    }

    const retailer = await OutletApproved.findById(
      distributorTransaction.retailerId
    ).lean();

    if (!retailer?.outletUID) {
      return res.status(400).json({
        status: 400,
        message: "Retailer UID missing",
      });
    }

    const lastRetailerTxn = await RetailerOutletTransaction.findOne({
      retailerId: distributorTransaction.retailerId,
    }).sort({ createdAt: -1 });

    const retailerBalance = lastRetailerTxn
      ? Number(lastRetailerTxn.balance)
      : Number(retailer.currentPointBalance) || 0;

    const transactionType =
      distributorTransaction.transactionType === "credit"
        ? "debit"
        : "credit";

    const newBalance =
      transactionType === "credit"
        ? retailerBalance + Number(distributorTransaction.point)
        : retailerBalance - Number(distributorTransaction.point);

    const retailerTxnCode = await retailerOutletTransactionCode("RTO");

    if (!retailerTxnCode) {
      return res.status(500).json({
        status: 500,
        message: "Failed to generate retailer transaction code",
      });
    }

    retailerOutletTransaction = new RetailerOutletTransaction({
      retailerId: distributorTransaction.retailerId,
      distributorTransactionId: distributorTransaction._id,
      transactionId: retailerTxnCode,
      transactionType,
      transactionFor: distributorTransaction.transactionFor,
      point: Number(distributorTransaction.point),
      balance: Number(newBalance),
      billId: distributorTransaction.billId,
      salesReturnId: distributorTransaction.salesReturnId,
      distributorId: distributorTransaction.distributorId,
      status: "Success",
      remark: distributorTransaction.remark,
      createdAt: distributorTransaction.createdAt,
      updatedAt: distributorTransaction.updatedAt,
    });

    retailerOutletTransaction.$timestamps(false);
    await retailerOutletTransaction.save();

    await OutletApproved.findByIdAndUpdate(
      distributorTransaction.retailerId,
      {
        currentPointBalance: newBalance,
      }
    );

    distributorTransaction.retailerOutletTransactionId =
      retailerOutletTransaction._id;

    await distributorTransaction.save({ timestamps: false });

    return res.status(200).json({
      status: 200,
      message: "Distributor transaction updated successfully",
      data: {
        distributorTransaction,
        retailerOutletTransaction,
      },
    });
  } catch (error) {
    console.error("Error updating distributor transaction:", error);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = updateDistributorTransaction;
