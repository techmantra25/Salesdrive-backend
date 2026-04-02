const asyncHandler = require("express-async-handler");
const BillSeries = require("../../models/billSeries.model");

const updateBillSeries = asyncHandler(async (req, res) => {
  try {
    const { _id: distributorId } = req.user;

    let billSeries = await BillSeries.findOne({ distributorId });
    if (!billSeries) {
      res.status(404);
      throw new Error("Bill series not found for this distributor");
    }

    billSeries.count = req.body.count;
    const updatedBillSeries = await billSeries.save();

    return res.status(200).json({
      status: 200,
      message: "Bill series updated successfully",
      data: updatedBillSeries,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateBillSeries };
