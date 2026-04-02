const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");

const allBeats = asyncHandler(async (req, res) => {
  try {
    let beats = await Beat.find({})
      .populate([
        {
          path: "regionId",
          select: "",
          populate: [
            {
              path: "stateId",
              select: "",
            },
          ],
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "employeeId",
          select: "name, empId,desgId",
          populate: [
            {
              path: "desgId",
              select: "name code",
            },
          ],
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "All Beats list",
      data: beats,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { allBeats };
