const mongoose = require('mongoose')

const new_billSeriesSchema = new mongoose.Schema({
    distributorId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Distributor",
        required:true,
    },
    prefix:{
        type:String,
        required:true,
    },
    series_number:{
        type:String,
        required:true,
    },
    currentNumber:{
      type:Number,
      required:true,
    },
    startDate:{
        type:Date,
        required:true,
        
    },
    endDate:{
        type:Date,
        default:null,

    },
    isActive: {
    type: Boolean,
    default: false,
    index: true
  },

},
{
  timestamps: true,
})

const new_billSeries = mongoose.model(
  "new_billSeries",
  new_billSeriesSchema
);

module.exports = new_billSeries;


