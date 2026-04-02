const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");

const outletList = asyncHandler(async (req, res) => {
  try {
    const outlets = await Outlet.find({})
      .populate([
        {
          path: "employeeId",
          select: "name empId zoneId regionId",
          populate: [
            {
              path: "zoneId",
              select: "name code",
            },
            {
              path: "regionId",
              select: "name code stateId",
              populate: {
                path: "stateId",
                select: "name code",
              },
            },
          ],
        },
        {
          path: "zsm",
          select: "name desgId",
          populate: {
            path: "desgId",
            select: "name",
          },
        },
        {
          path: "rsm",
          select: "name desgId",
          populate: { path: "desgId", select: "name" },
        },
        {
          path: "asm",
          select: "name desgId",
          populate: { path: "desgId", select: "name" },
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
      message: "Outlet list retrieved successfully",
      data: outlets,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { outletList };
