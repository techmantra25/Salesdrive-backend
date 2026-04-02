const asyncHandler = require("express-async-handler");
const District = require("../../models/district.model");

const allList = asyncHandler(async (req, res) => {
  try {
    let districtList = await District.find({})
      .populate([
        {
          path: "stateId",
          select: "",
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All District list",
      data: districtList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  allList,
};
