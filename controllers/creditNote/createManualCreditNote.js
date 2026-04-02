const asyncHandler = require("express-async-handler");
const CreditNoteModel = require("../../models/creditNote.model");
const {
  generateCode,
  ledgerTransactionCode,
} = require("../../utils/codeGenerator");
const Ledger = require("../../models/ledger.model");

const createManualCreditNote = asyncHandler(async (req, res) => {
  try {
    const { outletId, amount, creditNoteRemark } = req.body;

    // Validate required fields
    if (!outletId || !amount) {
      return res.status(400).json({
        status: 400,
        message: "Distributor ID, Outlet ID, and Amount are required",
      });
    }

    // Create a new manual credit note
    const newCreditNote = new CreditNoteModel({
      distributorId: req?.user?._id,
      outletId,
      lineItems: null, // Explicitly set lineItems to null
      creditNoteNo: await generateCode("CN"),
      amount,
      creditNoteRemark: creditNoteRemark || "", // Optional remark
      creditNoteType: "Manual Credit note", // Set type to Manual Credit note
      creditNoteStatus: "Pending",
    });

    // Save the credit note to the database
    const savedCreditNote = await newCreditNote.save();

    // TODO: Add a debit transaction for the ledger
    await new Promise((resolve) => setTimeout(resolve, 200));

    const latestLedger = await Ledger.findOne({
      dbId: req.user._id,
      retailerId: outletId,
    }).sort({ createdAt: -1 });

    let latestLedgerBalance = 0;
    if (latestLedger) {
      latestLedgerBalance = latestLedger?.balance;
    }

    const transactionId = await ledgerTransactionCode("LEDG", req.user._id);

    await Ledger.create({
      dbId: req.user._id,
      retailerId: outletId,
      transactionId,
      transactionType: "debit",
      transactionFor: "Credit Note",
      creditNoteId: savedCreditNote?._id,
      transactionAmount: Number(amount),
      balance: (Number(latestLedgerBalance) - Number(amount)).toFixed(2),
    });

    // Respond with the created credit note
    return res.status(201).json({
      status: 201,
      message: "Manual credit note created successfully",
      data: savedCreditNote,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createManualCreditNote };
