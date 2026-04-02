const asyncHandler = require("express-async-handler");
const CreditNoteModel = require("../../models/creditNote.model");

const toggleCreditNoteStatus = asyncHandler(async (req, res) => {
  try {
    const { creditNoteId } = req.params;
    const { isActive } = req.body;

    // Validate required fields
    if (!creditNoteId) {
      return res.status(400).json({
        status: 400,
        message: "Credit Note ID is required",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        status: 400,
        message: "isActive must be a boolean value",
      });
    }

    // Find and update the credit note
    const creditNote = await CreditNoteModel.findById(creditNoteId);

    if (!creditNote) {
      return res.status(404).json({
        status: 404,
        message: "Credit Note not found",
      });
    }

    // Check if credit note has been adjusted - prevent deactivation if adjusted
    if (!isActive && creditNote.adjustedBillIds?.length > 0) {
      const totalAdjusted = creditNote.adjustedBillIds.reduce(
        (sum, adj) => sum + Number(adj.adjustedAmount || 0),
        0,
      );

      if (totalAdjusted > 0) {
        return res.status(400).json({
          status: 400,
          message:
            "Cannot deactivate credit note that has been adjusted against bills",
        });
      }
    }

    // Update the status
    creditNote.isActive = isActive;
    await creditNote.save();

    return res.status(200).json({
      status: 200,
      message: `Credit Note ${isActive ? "activated" : "deactivated"} successfully`,
      data: creditNote,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { toggleCreditNoteStatus };
