const asyncHandler = require("express-async-handler");
const Password = require("../models/password.model");

const passwordDetail = asyncHandler(async (req, res) => {
  try {
    let passwordData = await Password.findOne({
      userId: req.params.userId,
    }).populate([
      {
        path: "userId",
        select: "",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "password Data",
      data: passwordData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  passwordDetail,
};
