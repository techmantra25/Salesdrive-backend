const asyncHandler = require("express-async-handler");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const mongoose = require("mongoose");
const { rebuildDistributorBalance } = require("../../controllers/distributorTransaction/rebuildDistributorBalance");
const DeletedInvoice = require("../../models/deletedInvoice");

/**
 * Delete distributor transaction by _id
 * @route DELETE /api/v1/distributor-transaction/:id
 * @access Private
 */
const deleteDistributorTransaction = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Validate id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Valid transaction ID is required");
    }

    // Find the transaction
    const transaction = await DistributorTransaction.findById(id);

    if (!transaction) {
      return res.status(404).json({
        status: 404,
        message: "Distributor transaction not found",
      });
    }

    const distributorId = transaction.distributorId;

    // Delete the transaction
    await DistributorTransaction.deleteOne({ _id: id });

    // Rebuild distributor balance
    const mockReq = {
      params: { distributorId: distributorId.toString() },
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
      invoiceNo: `${id}`, // Since invoiceNo is required, use transaction ID
      originalInvoiceData: transaction,
      deletedDbTransactions: [transaction],
      deletedApiTransactions: [],
      rebuildResult,
      deletedBy: req.user ? req.user._id : null, // Assuming req.user is set by middleware
    });

    return res.status(200).json({
      status: 200,
      message: "Distributor transaction deleted successfully, balance rebuilt",
      data: {
        deletedTransaction: id,
        rebuildResult,
        deletionLog: deletionLog._id,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  deleteDistributorTransaction,
};
