const asyncHandler = require("express-async-handler");
const BillSeries = require("../../models/billSeries.model");

const getBillSeries = asyncHandler(async (req, res) => {
  try {
    const { _id: distributorId } = req.user;

    let billSeries = await BillSeries.findOne({ distributorId });
    if (!billSeries) {
      const newBillSeries = await BillSeries.create({
        distributorId,
        count: 0,
      });
      billSeries = await BillSeries.findById(newBillSeries._id);
    }

    return res.status(200).json({
      status: 200,
      message: "Bill series retrieved successfully",
      data: billSeries,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { getBillSeries };
