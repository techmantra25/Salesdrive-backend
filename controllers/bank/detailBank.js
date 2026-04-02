const asyncHandler = require("express-async-handler");
const Bank = require("../../models/bank.model");

const detailBank = asyncHandler(async (req, res) => {
  try {
    // Find the bank by the bank ID (bid) from the request parameters
    let bankDetail = await Bank.findOne({ _id: req.params.bankId }).populate([
      {
        path: "distributorId", // Populate the distributorId field from the Distributor model
        select: "-password -genPassword", // Exclude the password and genPassword fields from the Distributor model
      },
    ]);

    if (!bankDetail) {
      res.status(404);
      throw new Error("Bank not found");
    }

    // Return the bank details if found
    return res.status(200).json({
      status: 200,
      message: "Bank details retrieved successfully",
      data: bankDetail,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailBank };
