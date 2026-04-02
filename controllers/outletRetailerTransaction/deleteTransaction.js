const asyncHandler = require("express-async-handler");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");

const deleteTransaction = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    // if id is not coming then throw error

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Retailer transaction id was not provided",
      });
    }
    // trying to find and delte the transaction
    const deletedTransaction = await RetailerOutletTransaction.findOneAndDelete(
      {
        _id: id,
        transactionFor: { $in: ["Opening Points", "Manual Point"] },
      },
    );

    // if no transaction is found

    if (!deletedTransaction) {
      return res.status(400).json({
        success: false,
        message: "Transaction not found or delete not allowed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Transaction deleted successfully",
      data: deletedTransaction,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "serever error",
    });
  }
});

module.exports = { deleteTransaction };
