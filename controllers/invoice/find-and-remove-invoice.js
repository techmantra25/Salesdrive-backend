const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Transaction = require("../../models/transaction.model");
// const DeletedInvoice = require("../../models/deletedInvoice.model");
const mongoose = require("mongoose");
const axios = require("axios");
const {
  rebuildDistributorBalance,
} = require("../../controllers/distributorTransaction/rebuildDistributorBalance");
const DeletedInvoice = require("../../models/deletedInvoice");
const { recalculateStockLedgerAfterDeletion } = require("../../controllers/transction/createStockLedgerEntry");

/**
 * Find invoice by distributor ID and invoice number and show details
 * @route POST /api/v1/invoice/find-and-remove-invoice
 * @access Private
 */
const findAndRemoveInvoice = asyncHandler(async (req, res) => {
  try {
    const { distributorId, invoiceNo } = req.body;

    // Validate distributorId
    if (!distributorId || !mongoose.Types.ObjectId.isValid(distributorId)) {
      res.status(400);
      throw new Error("Valid distributor ID is required");
    }

    // Validate invoiceNo
    if (
      !invoiceNo ||
      typeof invoiceNo !== "string" ||
      invoiceNo.trim() === ""
    ) {
      res.status(400);
      throw new Error("Valid invoice number is required");
    }

    // Find the invoice
    const invoice = await Invoice.findOne({
      distributorId: new mongoose.Types.ObjectId(distributorId),
      invoiceNo: invoiceNo.trim(),
    });

    if (!invoice) {
      return res.status(404).json({
        status: 404,
        message: "Invoice not found",
      });
    }

    // Find transactions from DB (like findTransaction.js)
    const dbTransactions = await DistributorTransaction.find({
      distributorId: new mongoose.Types.ObjectId(distributorId),
      invoiceId: new mongoose.Types.ObjectId(invoice._id),
    });

    // Call internal API for adjustments (like findadjustment.js but internal)
    const INTERNAL_API_URL = `${process.env.SERVER_URL}/api/v1/transaction/alllist-admins`;

    let apiTransactions = [];
    try {
      const response = await axios.post(
        INTERNAL_API_URL,
        {
          distributorId: distributorId,
        },
        {
          params: {
            page: 1,
            limit: 300,
            searchTerm: invoiceNo.trim(),
          },
        },
      );
      apiTransactions = response.data?.data || [];
    } catch (apiError) {
      console.error(`Internal API failed for ${invoiceNo}:`, apiError.message);
      apiTransactions = [];
    }

    // Delete transactions from Transaction model (apiTransactions)
    if (apiTransactions.length > 0) {
      const transactionIds = apiTransactions.map((t) => t._id);
      await Transaction.deleteMany({ _id: { $in: transactionIds } });
    }

    // Delete transactions from DistributorTransaction model (dbTransactions)
    if (dbTransactions.length > 0) {
      const dbTransactionIds = dbTransactions.map((t) => t._id);
      await DistributorTransaction.deleteMany({
        _id: { $in: dbTransactionIds },
      });
    }

    // Delete the invoice
    await Invoice.deleteOne({ _id: invoice._id });

    let stockLedgerRecalcResult = null;
    if (apiTransactions.length > 0) {
      try {
        stockLedgerRecalcResult =
          await recalculateStockLedgerAfterDeletion(apiTransactions);
        console.log(
          `Stock ledger recalculated: ${stockLedgerRecalcResult.deleted} deleted, ${stockLedgerRecalcResult.recalculated} recalculated`,
        );
      } catch (error) {
        console.error(`Stock ledger recalculation failed:`, error.message);
        // Don't throw - continue with balance rebuild
      }
    }

    // Rebuild distributor balance
    const mockReq = {
      params: { distributorId },
    };
    const mockRes = {
      status: (code) => ({
        json: (data) => data,
      }),
    };
    const rebuildResult = await rebuildDistributorBalance(mockReq, mockRes);

    // Save deletion log
    const deletionLog = await DeletedInvoice.create({
      distributorId: new mongoose.Types.ObjectId(distributorId),
      invoiceNo: invoice.invoiceNo,
      originalInvoiceData: invoice,
      deletedDbTransactions: dbTransactions,
      deletedApiTransactions: apiTransactions,
      rebuildResult,
    });

    return res.status(200).json({
      status: 200,
      message:
        "Invoice and related transactions removed successfully, balance rebuilt",
      data: {
        deletedInvoice: invoice._id,
        deletedDbTransactions: dbTransactions.length,
        deletedApiTransactions: apiTransactions.length,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  findAndRemoveInvoice,
};
