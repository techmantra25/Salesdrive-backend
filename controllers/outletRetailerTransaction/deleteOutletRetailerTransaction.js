// const asyncHandler = require("express-async-handler");
// const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
// const DeletedInvoice = require("../../models/deletedInvoice");

// const deleteOutletRetailerTransaction = asyncHandler(async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user?._id; // from auth middleware

//     // Find full transaction
//     const transaction = await RetailerOutletTransaction.findById(id);

//     if (!transaction) {
//       return res.status(404).json({
//         status: 404,
//         message: "Retailer outlet transaction not found",
//       });
//     }

//     // Convert mongoose document to plain object
//     const transactionData = transaction.toObject();

//     // Store FULL transaction data
//     await DeletedInvoice.create({
//       invoiceNo: transaction._id.toString(), // store transaction _id here
//       deletedBy: userId || null,
//       originalInvoiceData: transactionData,
//       deletedRetailerOutletTransactions: [transactionData],
//     });

//     // Delete original record
//     await RetailerOutletTransaction.deleteOne({ _id: id });

//     res.status(200).json({
//       status: 200,
//       message: "Retailer outlet transaction deleted successfully",
//     });
//   } catch (error) {
//     res.status(500).json({
//       status: 500,
//       message: "Error deleting retailer outlet transaction",
//       error: error.message,
//     });
//   }
// });

// module.exports = deleteOutletRetailerTransaction;