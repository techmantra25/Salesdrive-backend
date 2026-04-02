const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const generateToken = require("../../utils/generateToken");
const bcrypt = require("bcryptjs");

const retailerLogin = asyncHandler(async (req, res) => {
  try {
    const { outletCode, password } = req.body;

    if (!outletCode || !password) {
      res.status(400);
      throw new Error("outletCode and password are required");
    }

    const outlet = await OutletApproved.findOne({ outletCode });

    if (!outlet) {
      res.status(404);
      throw new Error("Outlet not found");
    }

    // Correct order: (plain, hash)
    const isMatchPassword = await bcrypt.compare(password, outlet.password);

    if (!isMatchPassword) {
      res.status(401);
      throw new Error("Invalid outletCode or password");
    }

    const token = generateToken(outlet._id);

    res.status(200).json({
      status: 200,
      data: {
        _id: outlet._id,
        name: outlet.ownerName,
        mobile1: outlet.mobile1,
        outletName: outlet.outletName,
        token: token,
        status: outlet.status,
      },
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = {
  retailerLogin,
};
