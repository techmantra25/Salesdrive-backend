const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
// detail

const storeDetail = asyncHandler(async (req, res) => {
  try {
    const contact  = req.query.contact;

    const outlet = await OutletApproved.find({
      mobile1: contact,
      status: true,
    }).populate([
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

module.exports = storeDetail;