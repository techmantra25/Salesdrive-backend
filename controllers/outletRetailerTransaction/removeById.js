const asyncHandler = require("express-async-handler");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");
const DeletedInvoice = require("../../models/deletedInvoice");
const mongoose = require("mongoose");

const removeRetailerOutletTransactionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: 400,
      message: "Transaction ID is required",
    });
  }

  // Find the transaction to delete
  const transaction = await RetailerOutletTransaction.findById(id);

  if (!transaction) {
    return res.status(404).json({
      status: 404,
      message: "Retailer outlet transaction not found",
    });
  }

  // Get the retailer to potentially update balance
  const retailer = await OutletApproved.findById(transaction.retailerId);

  if (!retailer) {
    return res.status(404).json({
      status: 404,
      message: "Associated retailer not found",
    });
  }

  // Delete the transaction
  await RetailerOutletTransaction.findByIdAndDelete(id);

  // Log the deletion
  const deletionLog = await DeletedInvoice.create({
    distributorId: null, // Not applicable for retailer transactions
    invoiceNo: transaction.transactionId, // Use transaction ID as invoiceNo
    originalInvoiceData: transaction,
    deletedRetailerOutletTransactions: [transaction],
    deletedBy: req.user ? req.user._id : null, // Assuming req.user is set by middleware
  });

  // Note: Balance recalculation is not implemented here as it would require
  // updating all subsequent transactions. This should be handled separately
  // or the balance should be manually corrected.

  return res.status(200).json({
    status: 200,
    message: "Retailer outlet transaction deleted successfully",
    data: {
      deletedTransaction: transaction,
      deletionLog: deletionLog._id,
    },
  });
});

module.exports = { removeRetailerOutletTransactionById };