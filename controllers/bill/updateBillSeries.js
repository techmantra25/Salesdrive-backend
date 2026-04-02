const new_billSeries = require("../../models/new_billseries.model");
const asyncHandler = require("express-async-handler");


const updateBillSeries = asyncHandler(async (req, res) => {
  const distributorId = req.user._id;
  const billSeriesId = req.params.id;
  const { prefix, series_number, startDate } = req.body;

  // First check existence + ownership
  const existing = await new_billSeries.findOne({
    _id: billSeriesId,
    distributorId,
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      message: "Bill series not found",
    });
  }

  // Business rule: cannot update started series
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getPreviousDay = (date) => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    d.setHours(23, 59, 59, 999);
    return d;
  }
  let checkDate =  new  Date(existing.startDate);
  checkDate.setHours(0,0,0,0);




  if (checkDate <= today) {
    return res.status(400).json({
      success: false,
      message: "Bill series already started and cannot be updated",
    });
  }

  // Build update payload safely
  const updatePayload = {};

  const finalPrefix = prefix ?? existing.prefix;
  const finalSeriesNumber =
    series_number !== undefined ? series_number : existing.series_number;

  const combinedLength = String(finalPrefix).trim().length + String(finalSeriesNumber).trim().length;

  if (combinedLength > 16) {
    return res.status(400).json({
      success: false,
      message: "Bill length exceeds 16 characters",
    });
  }

  if (prefix) updatePayload.prefix = prefix;

  console.log(`series number is ${series_number}`)

  if (series_number !== undefined && series_number !== "") {
    const seriesNumberStr = String(series_number).trim();
    
    // Validate digits only
    if (!/^\d+$/.test(seriesNumberStr)) {
        return res.status(400).json({
            success: false,
            message: "Series number must contain only digits"
        });
    }
    
    updatePayload.series_number = seriesNumberStr; // Store as string
    updatePayload.currentNumber = parseInt(seriesNumberStr, 10) - 1; // Calculate as number
}
  else {
    console.log("inside the else block")
    updatePayload.series_number = existing.series_number;
    console.log(`${existing.series_number}`)
    console.log(`${updatePayload.series_number}`)

    updatePayload.currentNumber = existing.currentNumber;
  }


  if (startDate) {
    const newStartDate = new Date(startDate);

    const previousSeries = await new_billSeries.findOne({
      distributorId,
      startDate: { $lt: newStartDate },
      _id: { $ne: billSeriesId },
    }).sort({ startDate: -1 });

    const nextSeries = await new_billSeries.findOne({
      distributorId,
      startDate: { $gt: newStartDate },
      _id: { $ne: billSeriesId },
    }).sort({ startDate: 1 });

    if (previousSeries) {
      previousSeries.endDate = getPreviousDay(newStartDate);
      await previousSeries.save();
    }

    updatePayload.startDate = newStartDate;
    updatePayload.endDate = nextSeries ? getPreviousDay(nextSeries.startDate) : null;
  }

  const updated = await new_billSeries.findOneAndUpdate(
    { _id: billSeriesId, distributorId },
    { $set: updatePayload },
    { new: true }
  );

  res.status(200).json({
    success: true,
    message: "Bill series updated successfully",
    data: updated,
  });
});

module.exports = {
  updateBillSeries,
}