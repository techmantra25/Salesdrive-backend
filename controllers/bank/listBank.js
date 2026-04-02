const asyncHandler = require("express-async-handler");
const Bank = require("../../models/bank.model");

const bankList = asyncHandler(async (req, res) => {
  try {
    // Fetch all banks, sorted by _id in descending order
    let banks = await Bank.find({ distributorId: req.user?._id })
      .populate([
        {
          path: "distributorId", // Populate the distributorId field from the Distributor model
          select: "-password -genPassword", // Exclude the password and genPassword fields from the Distributor model
        },
      ])
      .sort({
        _id: -1,
      });

    // Return the list of banks
    return res.status(200).json({
      status: 200,
      message: "All Bank list",
      data: banks,
    });
  } catch (error) {
    // Handle any errors
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { bankList };
