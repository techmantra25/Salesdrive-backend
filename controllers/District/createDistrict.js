const asyncHandler = require("express-async-handler");
const District = require("../../models/district.model");

const createDistrict = asyncHandler(async (req, res) => {
  try {
    const { code, name, stateId } = req.body;

    let districtExist = await District.findOne({
      code: code,
    });

    if (districtExist) {
      res.status(400);
      throw new Error("District already exists");
    }

    const districtData = await District.create({
      name,
      stateId,
      code,
    });

    return res.status(201).json({
      status: 201,
      message: "District created successfully",
      data: districtData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  createDistrict,
};
