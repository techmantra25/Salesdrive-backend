const mongoose = require("mongoose");

const debitNoteSchema = new mongoose.Schema(
  {},
  {
    timestamps: true,
  }
);

const DebitNote = mongoose.model("DebitNote", debitNoteSchema);

module.exports = DebitNote;
