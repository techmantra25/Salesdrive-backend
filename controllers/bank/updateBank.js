const asyncHandler = require("express-async-handler");
const Bank = require("../../models/bank.model");
const Distributor = require("../../models/distributor.model"); // Assuming there's a model that references Bank

const updateBank = asyncHandler(async (req, res) => {
  try {
    // Check if the bank is referenced in the Distributor model
    const distributorWithBank = await Distributor.findOne({
      bankId: req.params.bankId,
    });

    let message;

    if (distributorWithBank && req.body.hasOwnProperty("status")) {
      // If the bank is referenced in the Distributor model, remove the status field from the update payload
      delete req.body.status;
      message = {
        error: false,
        statusUpdateError: true,
        message:
          "Bank is referenced in the Distributor model, status cannot be updated",
      };
    }

    // Proceed with the bank update
    let updatedBank = await Bank.findOneAndUpdate(
      { _id: req.params.bankId },
      req.body,
      { new: true }
    );

    if (updatedBank) {
      if (!message) {
        message = {
          error: false,
          message: "Bank updated successfully",
          data: updatedBank,
        };
      } else {
        message.data = updatedBank;
      }
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Bank not updated",
      };
      return res.status(500).send(message);
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateBank };
