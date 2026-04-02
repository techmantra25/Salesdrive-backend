const asyncHandler = require("express-async-handler");
const Ledger = require("../../models/ledger.model");
const { ledgerTransactionCode } = require("../../utils/codeGenerator");
const mongoose = require("mongoose"); // Import mongoose for ObjectId validation

const BulkOpeningBalanceUpdate = asyncHandler(async (req, res) => {
  const { _id: dbId } = req.user;
  const { retailerIds } = req.body;

  // --- Input Validation ---
  if (!retailerIds || !Array.isArray(retailerIds) || retailerIds.length === 0) {
    res.status(400); // Bad Request
    throw new Error(
      "A non-empty array 'retailerIds' is required in the request body."
    );
  }

  const results = {
    successful: [],
    skipped: [], // Already have an opening balance entry
    failed: [], // Errors during processing
  };

  // --- Process each retailer using for...of for proper async/await ---
  for (const retailerData of retailerIds) {
    const id = retailerData?._id;
    const openingBalance = retailerData?.openingBalance; // Don't convert to Number yet

    // Validate individual retailer data
    if (
      !id ||
      !mongoose.Types.ObjectId.isValid(id) || // Validate ObjectId
      openingBalance === undefined ||
      openingBalance === null ||
      isNaN(Number(openingBalance)) // Check if convertible to number
    ) {
      results.failed.push({
        retailerId: id || "Invalid/Missing ID",
        reason: "Missing or invalid retailer _id or openingBalance.",
        data: retailerData, // Include original data for context
      });
      continue; // Skip to the next retailer
    }

    const balance = Number(openingBalance); // Now convert to number

    try {
      // Check if an opening balance entry already exists
      const existingEntry = await Ledger.findOne({
        dbId,
        retailerId: id,
        transactionFor: "Opening Balance",
      }).lean(); // Use lean for performance if only checking existence

      if (existingEntry) {
        results.skipped.push({
          retailerId: id,
          reason: "Opening balance entry already exists.",
          existingEntryId: existingEntry._id, // Provide ID of existing entry
        });
        continue; // Skip to the next retailer
      }

      // Generate transaction ID
      const transactionId = await ledgerTransactionCode("LEDG", dbId); // Assuming dbId is needed here

      // Create the new ledger entry
      const newLedgerEntry = await Ledger.create({
        dbId,
        retailerId: id,
        transactionId,
        transactionAmount: balance,
        balance: balance, // Opening balance sets the initial balance
        transactionType: balance >= 0 ? "credit" : "debit", // Typically credit, but handle negative OB
        transactionFor: "Opening Balance",
      });

      results.successful.push({
        retailerId: id,
        ledgerEntryId: newLedgerEntry._id,
        transactionId: newLedgerEntry.transactionId,
        balance: newLedgerEntry.balance,
      });
    } catch (error) {
      // Catch errors specific to this retailer's processing
      console.error(
        `Error processing opening balance for retailer ${id}:`,
        error
      );
      results.failed.push({
        retailerId: id,
        reason: error.message || "An unexpected error occurred.",
        error: error, // Optionally include error object (be careful with sensitive info)
      });
    }
  } // End of for...of loop

  // --- Send Response ---
  // Use 207 Multi-Status if there were partial successes/failures
  const responseStatus = results.failed.length > 0 ? 207 : 200;

  return res.status(responseStatus).json({
    status: responseStatus,
    message: "Bulk opening balance processing completed.",
    data: results, // Provide detailed results
  });
});

module.exports = { BulkOpeningBalanceUpdate };
