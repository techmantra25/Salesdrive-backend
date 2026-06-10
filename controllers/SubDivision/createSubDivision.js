const asyncHandler = require("express-async-handler");
const SubDivision = require("../../models/subDivision.model");

const createSubDivision = asyncHandler(async (req, res) => {
  try {
    const { code, name, districtId } = req.body;

    let subDivisionExist = await SubDivision.findOne({
      code: code,
    });

    if (subDivisionExist) {
      res.status(400);
      throw new Error("Sub Division already exists");
    }

    const subDivisionData = await SubDivision.create({
      name,
      districtId,
      code,
    });

    return res.status(201).json({
      status: 201,
      message: "Sub Division created successfully",
      data: subDivisionData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createSubDivision,
};
