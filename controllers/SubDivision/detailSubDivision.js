const asyncHandler = require("express-async-handler");
const SubDivision = require("../../models/subDivision.model");

const detailSubDivision = asyncHandler(async (req, res) => {
  try {
    let subDivisionList = await SubDivision.findOne({
      _id: req.params.sid,
    }).populate([
      {
        path: "districtId",
        select: "",
        populate: {
          path: "stateId",
          select: "",
        },
      },
    ]);
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
  detailSubDivision,
};
