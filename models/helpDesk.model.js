const mongoose = require("mongoose");

const helpDeskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
    },
    description: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      required: [true, "Type is required"],
      enum: ["image", "pdf", "video", "docs"],
    },
    fileUrl: {
      type: String,
      required: [true, "Please upload a file"],
      validate: {
        validator: function (v) {
          return /^https?:\/\/[^\s/$.?#].[^\s]*$/.test(v);
        },
        message: "Please enter a valid file URL",
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HelpDesk", helpDeskSchema);
