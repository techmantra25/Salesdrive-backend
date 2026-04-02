const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notification.model");

/**
 * @desc Get unread count
 * @route GET /api/v1/notifications/unread-count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const role = req.user.role;

  const count = await Notification.countDocuments({
    read: false,
    $or: [
      { userId },
      { role }
    ]
  });

  res.status(200).json({
    success: true,
    unreadCount: count,
  });
});

module.exports = { getUnreadCount };
