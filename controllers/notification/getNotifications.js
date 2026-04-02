const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notification.model");

const getNotifications = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    type = "all",
    fromDate,
    toDate,
    notificationType,
  } = req.query;

  const userId = req.user?._id;
  const role = req.user?.role; // 👈 IMPORTANT (admin check)

  // -------------------------
  // Build Base Query
  // -------------------------
  const query = {
    archived: { $ne: true },
  };

  // 🔥 If admin → fetch by role
  if (role === "admin") {
    query.role = "admin";
  }
  // 🔥 If normal user → fetch by userId
  else {
    query.userId = userId;
  }

  // -------------------------
  // Read / Unread Filter
  // -------------------------
  if (type === "read") {
    query.read = true;
  } else if (type === "unread") {
    query.read = false;
  }

  // -------------------------
  // Notification Type Filter
  // -------------------------
  if (notificationType) {
    query.type = notificationType;
  }

  // -------------------------
  // Date Filter
  // -------------------------
  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) {
      const startOfDay = new Date(fromDate);
      startOfDay.setHours(0, 0, 0, 0);
      query.createdAt.$gte = startOfDay;
    }
    if (toDate) {
      const endOfDay = new Date(toDate);
      endOfDay.setHours(23, 59, 59, 999);
      query.createdAt.$lte = endOfDay;
    }
  }

  // -------------------------
  // Fetch Notifications
  // -------------------------
  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .lean();

  const total = await Notification.countDocuments(query);

  // -------------------------
  // Unread Count
  // -------------------------
  const unreadQuery =
    role === "admin"
      ? { role: "admin", read: false }
      : { userId, read: false };

  const unreadCount = await Notification.countDocuments(unreadQuery);

  res.status(200).json({
    success: true,
    data: notifications,
    pagination: {
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      limit: Number(limit),
    },
    meta: {
      unreadCount,
    },
  });
});

module.exports = { getNotifications };
