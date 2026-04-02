const HelpDesk = require("../../models/helpDesk.model");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const updateHelpDesk = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, fileUrl, type } = req.body;

    // Validate ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid HelpDesk ID");
    }

    // Check if entry exists
    const helpDesk = await HelpDesk.findById(id);
    if (!helpDesk) {
      return res.status(404).json({
        status: 404,
        message: "HelpDesk entry not found",
      });
    }

    // Validate and update fields
    if (title !== undefined) {
      if (title.trim() === "") {
        res.status(400);
        throw new Error("Title cannot be empty");
      }
      helpDesk.title = title.trim();
    }

    if (description !== undefined) {
      helpDesk.description = description || null;
    }

    if (fileUrl !== undefined) {
      if (fileUrl.trim() === "") {
        res.status(400);
        throw new Error("File URL cannot be empty");
      }
      const urlRegex = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
      if (!urlRegex.test(fileUrl)) {
        res.status(400);
        throw new Error("Please enter a valid file URL");
      }
      helpDesk.fileUrl = fileUrl.trim();
    }

    if (type !== undefined) {
      if (type.trim() === "") {
        res.status(400);
        throw new Error("Type cannot be empty");
      }
      const allowedTypes = ["image", "pdf", "video", "docs"];
      if (!allowedTypes.includes(type)) {
        res.status(400);
        throw new Error(
          "Invalid type. Allowed values: image, pdf, video, docs"
        );
      }
      helpDesk.type = type.trim();
    }

    await helpDesk.save();

    return res.status(200).json({
      status: 200,
      message: "HelpDesk entry updated successfully",
      data: helpDesk,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateHelpDesk };
