const asyncHandler = require("express-async-handler");
const SubDivision = require("../../models/subDivision.model");

const allList = asyncHandler(async (req, res) => {
  try {
    let subDivisionList = await SubDivision.find({})
      .populate([
        {
          path: "districtId",
          select: "",
          populate: {
            path: "stateId",
            select: "",
          },
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "All Sub Division list",
      data: subDivisionList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  allList,
};
