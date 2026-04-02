const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");

const outletDetail = asyncHandler(async (req, res) => {
  const outletData = await Outlet.findById(req.params.outletId)
    .populate([
      {
        path: "employeeId",
        populate: [
          {
            path: "zoneId",
          },
          {
            path: "regionId",
            populate: {
              path: "stateId",
            },
          },
        ],
      },
      { path: "zsm" },
      { path: "rsm" },
      { path: "asm" },
      { path: "beatId" },
      { path: "distributorId" },
      { path: "sellingBrands" },
      { path: "zoneId" },
      { path: "stateId" },
      { path: "regionId" },
      { path: "district" },
    ])
    .lean();

  if (!outletData) {
    res.status(404);
    throw new Error("Outlet not found");
  }

  return res.status(200).json({
    status: 200,
    message: "Outlet details retrieved successfully",
    data: outletData,
  });
});

module.exports = { outletDetail };
