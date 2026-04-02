const asyncHandler = require("express-async-handler");
const outletApproved = require("../../models/outletApproved.model");

const getMe = asyncHandler(async (req, res) => {
  try {
    res.status(200).json({
      status: 200,
      data: {
        _id: req.user._id,
        outletName: req.user.outletName,
        outletUID: req.user.outletUID,
        ownerName: req.user.ownerName,
        mobile1: req.user.mobile1,
        mobile2: req.user.mobile2,
        token: req.user.token,
      },
    });
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  getMe,
};
