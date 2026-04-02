const bcrypt = require("bcryptjs");
const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

const changePassword = asyncHandler(async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const outletId = req.user._id;
    console.log(outletId);

    const outlet = await OutletApproved.findById(outletId).select("+password");
    if (!outlet) {
      return res.status(404).json({ message: "Outlet not found" });
    }

    const isMatch = await bcrypt.compare(oldPassword, outlet.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    // using salt and hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    outlet.password = hashedPassword;
    outlet.isPasswardReset = true;
    await outlet.save();

    return res.status(200).json({
      status: 200,
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  changePassword,
};
