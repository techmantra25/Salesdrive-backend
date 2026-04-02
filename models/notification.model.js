const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "userType",
      index: true,
    },
    userType: {
      type: String,
      enum: ["User", "Employee", "Distributor", "OutletApproved"],
      index: true,
    },
    role: {
      type: String,
      index: true,
    },
    type: {
      type: String,
      enum: ["giftOrder", "announcement", "downtime", "inventory", "purchaseOrder", "GRN","SalesOrder", "Target" ],
      index: true,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

/**
 * =====================================================
 * ✅ Validation: Either user-based OR role-based
 * =====================================================
 */
notificationSchema.pre("validate", function (next) {
  if (!this.userId && !this.role) {
    this.invalidate("userId", "Either userId or role must be provided");
  }
  if (this.userId && !this.userType) {
    this.invalidate("userType", "userType is required when userId is provided");
  }
  next();
});

/**
 * =====================================================
 * ✅ Compound Indexes (Optimized Fetching)
 * =====================================================
 */
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ role: 1, read: 1, createdAt: -1 });

/**
 * =====================================================
 * ✅ Text Search Index
 * =====================================================
 */
notificationSchema.index({ title: "text", message: "text" });

/**
 * =====================================================
 * 🔥 TTL AUTO DELETE (60 Days)
 * =====================================================
 * This will automatically delete notifications
 * after 60 days from createdAt.
 *
 * MongoDB runs cleanup every ~60 seconds.
 */
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 24 * 60 * 60 } // 60 days
);

module.exports = mongoose.model("Notification", notificationSchema);