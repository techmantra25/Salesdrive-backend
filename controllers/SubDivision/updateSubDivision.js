const asyncHandler = require("express-async-handler");
const SubDivision = require("../../models/subDivision.model");

const updateSubDivision = asyncHandler(async (req, res) => {
  try {
    const sid = req.params.sid;

    const subDivision = await SubDivision.findById(sid);

    if (!subDivision) {
      res.status(404);
      throw new Error("Sub Division not found");
    }

    const updatedSubDivision = await SubDivision.findOneAndUpdate(
      { _id: sid },
      req.body,
      {
        new: true,
      }
    );

    return res.status(200).json({
      status: 200,
      message: "Sub Division updated successfully",
      data: updatedSubDivision,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateSubDivision };
