const asyncHandler = require("express-async-handler");
const Reason = require("../../models/reason.model");

const reasonList = asyncHandler(async (req, res) => {
  try {
    let RegionList = await Reason.find({}).sort({ _id: -1 });
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

module.exports = { reasonList };
