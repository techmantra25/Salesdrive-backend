const mongoose = require("mongoose");

const billDeliverySettingSchema = new mongoose.Schema(
  {
    distributorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Distributor",
      required: true,
      unique: true,
    },
    deliveryDurationDays: {
      type: Number,
      required: function () {
        return this.isActive !== false;
      },
      min: 1,
      max: 30,
      default: 7, // Default 7 days
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    enableBackdateBilling: {
      type: Boolean,
      default: false,
      // When YES (true): Apply backdate billing logic (BILL DELIVERY ONLY)
      //   - No locking of bills generated on last day of Feb
      //   - Can manually deliver, auto-deliver cron will deliver only previous month bills
      //   - If bill on Feb and delivered on Mar 1-4, delivery date takes last day of month
      //   - Bills generated on 1-3 of Mar will not be included in 4th Mar cron
      //   - Multiplier calculated based on month (1-3 grace period)
      // When NO (false): Do not apply backdate billing logic
      //   - Bills not auto-delivered by cron
      //   - Takes real-time delivery date (not last date of month)
    },
    enableBackdateOrder: {
      type: Boolean,
      default: false,
      // When YES (true): Apply backdate order logic (ORDER & ORDER-TO-BILL ONLY)
      //   - Orders can be backdated (1-4 of May takes original date for that month)
      //   - Order to Bill transformations can be backdated
      //   - Cross month order and order-to-bill backdate is disabled
      // When NO (false): Do not apply backdate order logic
      //   - Orders and order-to-bill take current dates
      //   - No backdating allowed for orders
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

// Index for faster queries
// billDeliverySettingSchema.index({ distributorId: 1 });
billDeliverySettingSchema.index({ isActive: 1 });

const BillDeliverySetting = mongoose.model(
  "BillDeliverySetting",
  billDeliverySettingSchema,
);

module.exports = BillDeliverySetting;
