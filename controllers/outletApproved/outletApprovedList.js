const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

const outletApprovedList = asyncHandler(async (req, res) => {
  try {
    const outletsApproved = await OutletApproved.find({})
      .populate([
        {
          path: "zoneId",
          select: "name code",
        },
        {
          path: "regionId",
          select: "name code",
        },
        {
          path: "stateId",
          select: "name code",
        },
        {
          path: "beatId",
          select: "name code",
        },

        {
          path: "distributorId",
          select: "name dbCode",
        },

        {
          path: "sellingBrands",
          select: "name code",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "Outlet Approved list",
      data: outletsApproved,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  outletApprovedList,
};
