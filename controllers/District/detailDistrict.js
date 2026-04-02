const asyncHandler = require("express-async-handler");
const District = require("../../models/district.model");

const detailDistrict = asyncHandler(async (req, res) => {
  try {
    let DistrictList = await District.findOne({ _id: req.params.did }).populate(
      [
        {
          path: "stateId",
          select: "",
        },
      ]
    );
    return res.status(201).json({
      status: 201,
      message: "All District list",
      data: DistrictList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  detailDistrict,
};
