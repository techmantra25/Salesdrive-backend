const new_billSeries = require('../../models/new_billseries.model')
const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");

const createNewbillSeries = asyncHandler(async(req, res) => {
    try {
        const distributorId = req.user._id;

        // Check if the distributor exists or not
        const distributor = await Distributor.findById(distributorId);
        if (!distributor) {
            return res.status(400).json({
                success: false,
                message: "Distributor not found"
            });
        }
        console.log(`Distributor id - ${distributorId}`);
        
        // Details from the frontend
        const {
            prefix,
            series_number,
            startDate,
        } = req.body;
        console.log(`prefix - ${prefix}, series-number - ${series_number}, date - ${startDate}`);

        // Check to validate
        if (!prefix || series_number === undefined || !startDate) {
            return res.status(400).json({
                success: false,
                message: "Prefix, series number and start date are required"
            })
        }

        // ✅ Keep series_number as string to preserve leading zeros
        const seriesNumberStr = String(series_number).trim();
        
        // ✅ Validate that series_number contains only digits
        if (!/^\d+$/.test(seriesNumberStr)) {
            return res.status(400).json({
                success: false,
                message: "Series number must contain only digits"
            });
        }

        const checkDate = new Date(startDate);
        checkDate.setHours(0,0,0,0);

        const today = new Date();
        today.setHours(0,0,0,0);

        // ✅ FIXED: Only block past dates, allow today
        if(checkDate < today){
            return res.status(400).json({
                success:false,
                message:"You cannot create bill series on past dates"
            })
        }

        // ✅ FIXED: Check if there's already a bill series with this exact startDate
        const existingSeriesOnDate = await new_billSeries.findOne({
            distributorId,
            startDate: checkDate,
        });

        if(existingSeriesOnDate){
            return res.status(400).json({
                success: false,
                message: "A bill series with this start date already exists"
            })
        }

        // ✅ FIXED: Combined length calculation using string
        const combinedLength = String(prefix).trim().length + seriesNumberStr.length;

        if (combinedLength > 16) {
            return res.status(400).json({
                success: false,
                message: "Length exceeds the 16 digit bill size validation"
            });
        }

        const newStartDate = new Date(startDate);
        newStartDate.setHours(0,0,0,0);

        const getPreviousDay = (date) => {
            const d = new Date(date);
            d.setDate(d.getDate() - 1);
            d.setHours(23, 59, 59, 999);
            return d;
        }

        // Finding previous series that was started just before it 
        const previousSeries = await new_billSeries.findOne({
            distributorId,
            startDate: { $lt: newStartDate },
        }).sort({ startDate: -1 });

        // Finding the next series just after this one
        const nextSeries = await new_billSeries.findOne({
            distributorId,
            startDate: { $gt: newStartDate },
        }).sort({ startDate: 1 });

        if (previousSeries) {
            previousSeries.endDate = getPreviousDay(newStartDate);
            await previousSeries.save();
        }

        // ✅ Calculate currentNumber by decrementing the numeric value
        // but store series_number as string to preserve leading zeros
        const numericValue = parseInt(seriesNumberStr, 10);
        const currentNumber = numericValue - 1;

        // Create the new bill series
        const billSeries = await new_billSeries.create({
            distributorId,
            prefix: prefix.trim(),
            series_number: seriesNumberStr, // ✅ Store as string to preserve leading zeros
            currentNumber: currentNumber, // ✅ Store numeric value for increment logic
            startDate: newStartDate,
            endDate: nextSeries ? getPreviousDay(nextSeries.startDate) : null,
        });

        res.status(201).json({
            success: true,
            message: "Bill series created successfully",
            data: billSeries,
        });

    } catch (error) {
        console.error('Error creating bill series:', error);
        res.status(500);
        throw error;
    }
});

module.exports = {
    createNewbillSeries
}