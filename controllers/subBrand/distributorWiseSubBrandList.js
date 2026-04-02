const asyncHandler = require("express-async-handler");
const SubBrand = require("../../models/subBrand.model");
const Distributor = require("../../models/distributor.model");

const distributorSubBrandList = asyncHandler(async (req, res) => {
  try {
    const { distributorId } = req.params;
    console.log("Received request for distributor ID:", distributorId);
    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      return res.status(404).json({
        status: 404,
        message: "Distributor not found",
      });
    }

    let subBrandList = await SubBrand.find({
      brandId: { $in: distributor.brandId },
      status: true, 
    })
      .populate({
        path: "brandId",
        match: { status: true },
      })
      .sort({ _id: -1 });

    subBrandList = subBrandList.filter((item) => item.brandId !== null);

    return res.status(201).json({
      status: 201,
      message: "All SubBrand list",
      data: subBrandList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  distributorSubBrandList,
};