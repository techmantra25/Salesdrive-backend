const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");

const listbyproduct = asyncHandler(async (req, res) => {
  try {
    const transactionData = await Transaction.find({
      $and: [
        { productId: req.params.productId },
        { distributorId: req.params.distributorId },
      ],
    })
      .populate([
        {
          path: "distributorId",
          select: " ",
        },
        {
          path: "invItemId",
          select: "name desgId",
        },
        {
          path: "productId",
          select: "name product_code",
        },
      ])
      .sort({ _id: -1 });

    return res.status(200).json({
      status: 200,
      message: "Transaction list retrieved successfully",
      data: transactionData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { listbyproduct };
