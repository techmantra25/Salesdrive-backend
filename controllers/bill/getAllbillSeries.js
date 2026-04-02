const new_billSeries = require("../../models/new_billseries.model");
const asyncHandler = require("express-async-handler");


const getAllbillSeries = asyncHandler(async(req,res) => {
    const distributorId = req.user._id;
    const today = new Date();
    today.setHours(0,0,0,0);

    await new_billSeries.updateMany(
        {distributorId},
        {$set:{isActive:false}}
    )

    const activeSeries = await new_billSeries.findOne({
        distributorId:distributorId,
        startDate:{$lte:today},
        $or:[
            {endDate:{$gte:today}},
            {endDate:null}
        ]
    }).sort({startDate:-1});

    if(activeSeries){
        await new_billSeries.findByIdAndUpdate(
            activeSeries._id,
            {$set:{isActive:true}}
        )
    }

    const query = {distributorId};

    if(req.query.prefix){
        query.prefix = {$regex : req.query.prefix, $options: 'i'};

    }

    if(req.query.series_number){
    query.series_number = String(req.query.series_number).trim();
}

    if(req.query.startDate){
        const searchDate = new Date(req.query.startDate);
        searchDate.setHours(0,0,0,0);
        query.startDate = searchDate;
    }

    if(req.query.isActive !== undefined){
        query.isActive = req.query.isActive === 'true' || req.query.isActive === true;
    }
    const billSeriesList = await new_billSeries.find(query).sort({startDate:1});

    res.status(200).json({
        success:true,
        count:billSeriesList.length,
        data:billSeriesList,
    })
})

module.exports = {
    getAllbillSeries,
}