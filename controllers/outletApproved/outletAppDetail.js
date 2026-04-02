const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

const outletAppDetail = asyncHandler(async (req, res) => {
  try {
    const outletData = await OutletApproved.findById(
      req.params.outletAppId
    ).populate([
      {
        path: "zoneId",
        select: "",
      },
      {
        path: "rsm",
        select: "",
      },
      {
        path: "asm",
        select: "",
      },
      {
        path: "zsm",
        select: "",
      },
      {
        path: "regionId",
        select: "",
      },
      {
        path: "stateId",
        select: "",
      },
      {
        path: "beatId",
        select: "",
      },

      {
        path: "distributorId",
        select: "",
      },

      {
        path: "sellingBrands",
        select: "",
      },
      {
        path: "createdFromLead",
        select: "",
      },
      {
        path: "employeeId",
        select: "",
      },
      {
        path: "createdBy",
        select: "",
      },
      {
        path: "district",
        select: "",
      },
      {
        path: "referenceId",
        select: "",
      },
    ]);
    if (!outletData) {
      res.status(404);
      throw new Error("Outlet not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Outlet details retrieved successfully",
      data: outletData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  outletAppDetail,
};
