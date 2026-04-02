const HelpDesk = require("../../models/helpDesk.model");
const asyncHandler = require("express-async-handler");

const createHelpDesk = asyncHandler(async (req, res) => {
  try {
    const { title, description, fileUrl, type } = req.body;

    // Validate required fields
    if (!title || title.trim() === "") {
      res.status(400);
      throw new Error("Title is required");
    }

    if (!fileUrl || fileUrl.trim() === "") {
      res.status(400);
      throw new Error("File URL is required");
    }

    if (!type || type.trim() === "") {
      res.status(400);
      throw new Error("Type is required");
    }

    // Validate fileUrl format
    const urlRegex = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
    if (!urlRegex.test(fileUrl)) {
      res.status(400);
      throw new Error("Please enter a valid file URL");
    }

    // Validate type
    const allowedTypes = ["image", "pdf", "video", "docs"];
    if (!allowedTypes.includes(type)) {
      res.status(400);
      throw new Error("Invalid type. Allowed values: image, pdf, video, docs");
    }

    // Create new HelpDesk entry
    const newHelpDesk = await HelpDesk.create({
      title: title.trim(),
      description: description || null,
      fileUrl: fileUrl.trim(),
      type: type.trim(),
    });

    return res.status(201).json({
      status: 201,
      message: "HelpDesk entry created successfully",
      data: newHelpDesk,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createHelpDesk };
