const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transaction.model");

const updateTransactionQty = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { qty, date } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required",
      });
    }

    if (qty === undefined || qty === null) {
      return res.status(400).json({
        success: false,
        message: "Quantity is required",
      });
    }

    if (qty < 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity cannot be negative",
      });
    }

    // date check

    if (date !== undefined && date !== null) {
      if (isNaN(new Date(date).getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format",
        });
      }
      if (new Date(date) > new Date()) {
        return res.status(400).json({
          success: false,
          message: "Date can not be set to future date",
        });
      }
    }
    const transaction = await Transaction.findById(id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }
    // version 1 of the code
    // transaction.qty = qty;
    // transaction.date = new Date(date);
    // await transaction.save();

    // version two since we need to update the createdat date

    // const updatedTransaction = await Transaction.findByIdAndUpdate(
    //   id,
    //   {
    //     $set: {
    //       qty: qty,
    //       date: new Date(date),
    //       createdAt: new Date(date),
    //     },
    //   },
    //   {
    //     new: true,timestamps:false,
    //   },
    // );

    await Transaction.collection.updateOne(
        {_id:transaction._id},
        {
            $set:{
                qty:qty,
                date:new Date(date),
                createdAt:new Date(date),
            }
        }
    );
    const updatedTransaction = await Transaction.findById(id);


    res.status(200).json({
      success: true,
      message: "Transaction quantity updated successfully",
      data: updatedTransaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating transaction quantity",
      error: error.message,
    });
  }
});

module.exports = { updateTransactionQty };
