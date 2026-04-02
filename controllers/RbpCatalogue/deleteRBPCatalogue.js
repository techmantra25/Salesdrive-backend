const asyncHandler = require("express-async-handler");
const RBPCatalogue = require("../../models/rbp-catalouge.model");

const deleteRBPCatalogue = asyncHandler(async (req, res) => {
  try {
    const catalogueData = await RBPCatalogue.findOneAndDelete({ _id: req.params.id });
    if (!catalogueData) {
      res.status(404);
      throw new Error("RBP Catalogue not found");
    }
    return res.status(200).json({
      status: 200,
      message: "RBP Catalogue deleted successfully",
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { deleteRBPCatalogue };