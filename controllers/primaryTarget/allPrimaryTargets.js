const asyncHandler = require("express-async-handler");
const PrimaryTarget = require("../../models/primaryTarget.model");

const allPrimaryTargets = asyncHandler(async (req, res) => {
  try {
    let primaryTargets = await PrimaryTarget.find({})
      .populate([
        {
          path: "regionId",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "created_by",
          select: "",
        },
        {
          path: "updated_by",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "All primary targets list",
      data: primaryTargets,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { allPrimaryTargets };