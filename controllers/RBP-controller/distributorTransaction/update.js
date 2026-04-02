const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  retailerOutletTransactionCode,
} = require("../../../utils/codeGenerator");

const updateDistributorTransaction = asyncHandler(async (req, res) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({
        status: 400,
        message: "Invalid transactionId",
      });
    }

    // 1️⃣ Find successful distributor transaction
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

    // 2️⃣ If retailer transaction already exists → return it
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

    // 3️⃣ Fetch retailer
    const retailer = await OutletApproved.findById(
      distributorTransaction.retailerId
    ).lean();

    if (!retailer?.outletUID) {
      return res.status(400).json({
        status: 400,
        message: "Retailer UID missing",
      });
    }

    // 4️⃣ Get last retailer transaction
    const lastRetailerTxn = await RetailerOutletTransaction.findOne({
      retailerId: distributorTransaction.retailerId,
    }).sort({ createdAt: -1 });

    // 5️⃣ Calculate balance
    const retailerBalance = lastRetailerTxn
      ? Number(lastRetailerTxn.balance)
      : Number(retailer.currentPointBalance) || 0;

    // 6️⃣ Reverse transaction type
    const transactionType =
      distributorTransaction.transactionType === "credit"
        ? "debit"
        : "credit";

    const newBalance =
      transactionType === "credit"
        ? retailerBalance + Number(distributorTransaction.point)
        : retailerBalance - Number(distributorTransaction.point);

    // 7️⃣ Generate retailer transaction code
    const retailerTxnCode = await retailerOutletTransactionCode("RTO");

    if (!retailerTxnCode) {
      return res.status(500).json({
        status: 500,
        message: "Failed to generate retailer transaction code",
      });
    }

    console.log(newBalance,'newBalance');

    // 8️⃣ Create RetailerOutletTransaction (timestamps preserved)
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

    // 🔒 Disable auto timestamps
    retailerOutletTransaction.$timestamps(false);
    await retailerOutletTransaction.save();

    // 9️⃣ Update retailer current balance
    await OutletApproved.findByIdAndUpdate(distributorTransaction.retailerId, {
      currentPointBalance: newBalance,
    });

    // 🔟 Update distributor transaction WITHOUT touching dates
    distributorTransaction.retailerOutletTransactionId =
      retailerOutletTransaction._id;

    await distributorTransaction.save({ timestamps: false });

    // 🔟 Final response
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