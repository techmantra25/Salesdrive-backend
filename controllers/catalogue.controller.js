const mongoose = require("mongoose");
const Catalogue = require("../models/catalogue.model");
const asyncHandler = require("express-async-handler");

const createCatalogue = asyncHandler(async (req, res) => {
  try {
    const { title, url, status } = req.body;

    // Validate required fields
    if (!title || title.trim() === "") {
      res.status(400);
      throw new Error("Title is required");
    }

    if (!url || !Array.isArray(url) || url.length === 0) {
      res.status(400);
      throw new Error("At least one URL is required");
    }

    // Validate URLs
    for (let i = 0; i < url.length; i++) {
      const file = url[i];
      if (!file.url || file.url.trim() === "") {
        res.status(400);
        throw new Error(`URL at index ${i} is required`);
      }
      if (
        !file.fileType ||
        !["pdf", "image", "video"].includes(file.fileType)
      ) {
        res.status(400);
        throw new Error(`Invalid fileType at index ${i}`);
      }
    }

    // Validate status if provided
    if (status && !["draft", "active", "inactive"].includes(status)) {
      res.status(400);
      throw new Error("Status must be one of: draft, active, inactive");
    }

    // Check for duplicate title
    const existingCatalogue = await Catalogue.findOne({ title: title.trim() });
    if (existingCatalogue) {
      res.status(400);
      throw new Error("Catalogue with this title already exists");
    }

    const newCatalogue = await Catalogue.create({
      title: title.trim(),
      url,
      status: status || "draft",
    });

    return res.status(201).json({
      status: 201,
      message: "Catalogue created successfully",
      data: newCatalogue,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const getCatalogueDetail = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid catalogue ID");
    }

    const catalogue = await Catalogue.findById(id);

    if (!catalogue) {
      return res.status(404).json({
        status: 404,
        message: "Catalogue not found",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Catalogue fetched successfully",
      data: catalogue,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const updateCatalogue = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { title, url, status } = req.body;

    // Validate ID
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid catalogue ID");
    }

    // Check if catalogue exists
    const catalogue = await Catalogue.findById(id);
    if (!catalogue) {
      return res.status(404).json({
        status: 404,
        message: "Catalogue not found",
      });
    }

    // Validate inputs if provided
    if (title !== undefined) {
      if (title.trim() === "") {
        res.status(400);
        throw new Error("Title cannot be empty");
      }
      // Check for duplicate title
      if (title.trim() !== catalogue.title) {
        const existingCatalogue = await Catalogue.findOne({
          title: title.trim(),
          _id: { $ne: id },
        });
        if (existingCatalogue) {
          res.status(400);
          throw new Error("Catalogue with this title already exists");
        }
      }
      catalogue.title = title.trim();
    }

    if (url !== undefined) {
      if (!Array.isArray(url) || url.length === 0) {
        res.status(400);
        throw new Error("At least one URL is required");
      }
      // Validate URLs
      for (let i = 0; i < url.length; i++) {
        const file = url[i];
        if (!file.url || file.url.trim() === "") {
          res.status(400);
          throw new Error(`URL at index ${i} is required`);
        }
        if (
          !file.fileType ||
          !["pdf", "image", "video"].includes(file.fileType)
        ) {
          res.status(400);
          throw new Error(`Invalid fileType at index ${i}`);
        }
      }
      catalogue.url = url;
    }

    if (status !== undefined) {
      if (!["draft", "active", "inactive"].includes(status)) {
        res.status(400);
        throw new Error("Status must be one of: draft, active, inactive");
      }
      catalogue.status = status;
    }

    await catalogue.save();

    return res.status(200).json({
      status: 200,
      message: "Catalogue updated successfully",
      data: catalogue,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const listCatalogues = asyncHandler(async (req, res) => {
  try {
    const catalogues = await Catalogue.find().sort({ createdAt: -1 });
    return res.status(200).json({
      status: 200,
      message: "Catalogues fetched successfully",
      data: catalogues,
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createCatalogue,
  getCatalogueDetail,
  updateCatalogue,
  listCatalogues,
};
