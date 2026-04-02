const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");

const listByEmpId = asyncHandler(async (req, res) => {
  try {
    const { empId } = req.params;

    const beats = await Beat.find({
      employeeId: { $in: [empId] },
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

module.exports = { listByEmpId };
