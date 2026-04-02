
const asyncHandler = require("express-async-handler");
const Bank = require("../../models/bank.model");

// Assuming the distributorId is stored in req.user from the authentication middleware
const createBank = asyncHandler(async (req, res) => {
  try {
    const { name } = req.body;

    // DistributorId should be taken from authenticated user
    const distributorId = req.user?._id;

    // Check if a bank with the same name and distributorId already exists
    let bankExist = await Bank.findOne({
      $and: [{ name: req.body.name }, { distributorId: distributorId }],
    });

    if (bankExist) {
      res.status(400);
      throw new Error("Bank already exists");
    }

    // Create new bank data
    const bankData = await Bank.create({
      name,
      distributorId, // Use distributorId from the authenticated user
    });

    // Return successful response
    return res.status(201).json({
      status: 201,
      message: "Bank created successfully",
      data: bankData,
    });
  } catch (error) {
    // Handle error
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createBank };
