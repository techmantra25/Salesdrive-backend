const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");
const OutletApproved = require("../../models/outletApproved.model");

const detailBeat = asyncHandler(async (req, res) => {
  try {
    let beat = await Beat.findOne({ _id: req.params.bid }).populate([
      {
        path: "regionId",
        select: "name code",
      },
      {
        path: "distributorId",
        select: "name code",
      },
      {
        path: "employeeId",
        select: "",
        populate: [
          {
            path: "desgId",
            select: "",
          },
        ],
      },
    ]);

    if (!beat) {
      res.status(404);
      throw new Error("Beat not found");
    }

    const beatOutlet = await OutletApproved.countDocuments({
      beatId: req.params.bid,
    });

    return res.status(200).json({
      status: 200,
      message: "Beat details retrieved successfully",
      data: {
        ...beat?._doc,
        beatOutlet,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailBeat };
