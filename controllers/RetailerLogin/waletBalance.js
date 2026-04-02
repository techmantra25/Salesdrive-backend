const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
// detail

const walletBalance = asyncHandler(async (req, res) => {
  try {
    const id  = req.params.id;

    const outlet = await OutletApproved.findOne({
      _id: id,
      status: true,
    }).select("currentPointBalance");


    if (!outlet) {
      return res.status(404).json({
        status: 404,
        message: "Outlet not found",
      });
    }

    const balance = outlet.currentPointBalance;

    return res.status(200).json({
      status: 200,
      message: "Wallet Balance fetched successfully",
      data: balance,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
}); 

module.exports = walletBalance;