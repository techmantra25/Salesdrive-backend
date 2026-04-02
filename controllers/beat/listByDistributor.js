const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");
const OutletApproved = require("../../models/outletApproved.model");

const listByDistributor = asyncHandler(async (req, res) => {
  try {
    let beats = await Beat.find({
      distributorId: { $in: [req.params.did] },
    })
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
          path: "employeeId",
          select: "",
          populate: [
            {
              path: "desgId",
              select: "",
            },
          ],
        },
      ])
      .sort({ _id: -1 });

    const beatListWithOutlet = await Promise.all(
      beats.map(async (beat) => {
        const beatOutlet = await OutletApproved.countDocuments({
          beatId: beat._id,
        });
        return { ...beat.toObject(), beatOutlet };
      })
    );

    return res.status(200).json({
      status: 200,
      message: "All Beats list",
      data: beatListWithOutlet,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { listByDistributor };
