const asyncHandler = require("express-async-handler");
const Reason = require("../../models/reason.model");

const reasonListbyModule = asyncHandler(async (req, res) => {
  try {
    const moduleName =
      req.params.moduleName || req.query.module || req.query.moduleName;
    if (!moduleName) {
      return res.status(400).json({
        status: 400,
        message: "moduleName is required",
        data: null,
      });
    }

    let RegionList = await Reason.find({ module: moduleName }).sort({
      _id: -1,
    });
    return res.status(201).json({
      status: 201,
      message: "All Reason list",
      data: RegionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { reasonListbyModule };
