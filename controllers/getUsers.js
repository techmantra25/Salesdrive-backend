const asyncHandler = require("express-async-handler");
const User = require("../models/user.model.js");

const getAllUsers = asyncHandler(async (req, res) => {
    console.log("Fetching all users...");
  const users = await User.find({})
    .select("-password") // hide password
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: users,
  });
});

module.exports = { getAllUsers };
