const asyncHandler = require("express-async-handler");
const RBPCatalogue = require("../../models/rbp-catalouge.model");

const createRBPCatalogue = asyncHandler(async (req, res) => {
  try {
    const { title, description, imageUrl, fileUrl, status } = req.body;

    const catalogueData = await RBPCatalogue.create({
      title,
      description,
      imageUrl,
      fileUrl,
      status,
    });

    return res.status(201).json({
      status: 201,
      message: "RBP Catalogue created successfully",
      data: catalogueData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createRBPCatalogue };