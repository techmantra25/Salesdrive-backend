const asyncHandler = require("express-async-handler");
const RetailerMultiplierTransaction = require("../../models/retailerMultiplierTransaction.model");
const DeletedInvoice = require("../../models/deletedInvoice");

const deleteRetailerMultiplierTransaction = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id; // from auth middleware

    // Find full transaction
    const transaction = await RetailerMultiplierTransaction.findById(id);

    if (!transaction) {
      return res.status(404).json({
        status: 404,
        message: "Retailer multiplier transaction not found",
      });
    }

    // Convert mongoose document to plain object
    const transactionData = transaction.toObject();

    // Store FULL transaction data
    await DeletedInvoice.create({
      invoiceNo: transaction._id.toString(), // store transaction _id here
      deletedBy: userId || null,
      originalInvoiceData: transactionData,
      deletedRetailerMultiplierTransactions: [transactionData],
    });

    // Delete original record
    await RetailerMultiplierTransaction.deleteOne({ _id: id });

    res.status(200).json({
      status: 200,
      message: "Retailer multiplier transaction deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: 500,
      message: "Error deleting retailer multiplier transaction",
      error: error.message,
    });
  }
});

module.exports = deleteRetailerMultiplierTransaction;
