const asyncHandler = require("express-async-handler");
const DbBank = require("../../models/dbBank.model");

const getBankData = asyncHandler(async (req, res) => {
  try {
    const bankData = await DbBank.find({
    }).populate([
        {
            path: "distributorId",
            select: "name dbCode",
        }
    ]);

    if (!bankData) {
      res.status(404);
      throw new Error("Bank not found");
    }

    // Return the bank data
    return res.status(200).json({
      status: 200,
      message: "Bank details fetched successfully",
      data: bankData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Fetch bank data

module.exports = { getBankData };