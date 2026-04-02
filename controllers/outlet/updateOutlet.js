const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");

const updateOutlet = asyncHandler(async (req, res) => {
  try {
    const updatedOutlet = await Outlet.findByIdAndUpdate(
      req.params.outletId,
      req.body,
      { new: true }
    );

    if (!updatedOutlet) {
      res.status(404);
      throw new Error("Outlet not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Outlet updated successfully",
      data: updatedOutlet,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateOutlet };
