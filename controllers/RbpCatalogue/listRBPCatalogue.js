const asyncHandler = require("express-async-handler");
const RBPCatalogue = require("../../models/rbp-catalouge.model");

const listRBPCatalogue = asyncHandler(async (req, res) => {
  try {
    let { status } = req.query;

    let filter = {};
    if (status !== undefined) {
      filter.status = status === 'true';
    }

    const catalogueList = await RBPCatalogue.find(filter).sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "RBP Catalogue list",
      data: catalogueList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { listRBPCatalogue };
