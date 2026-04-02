const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
// detail

const retailerProfile = asyncHandler(async (req, res) => {
  try {
    const id  = req.params.id;

    const outlet = await OutletApproved.findOne({
      _id: id,
      status: true,
    })
    .select(" ")
    .populate([
        {
            path:"beatId",
            select:"code name"
        },
        {
            path:"stateId",
            select:"name"
        },
    ]);

    if (!outlet) {
      return res.status(404).json({
        status: 404,
        message: "Outlet not found",
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Store detail fetched successfully",
      data: outlet,
    });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
      error: error.message,
    });
  }
}); 

module.exports = retailerProfile;