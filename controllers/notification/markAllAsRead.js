const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notification.model");

/**
 * @desc Mark all notifications as read
 * @route PATCH /api/v1/notifications/read-all
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const role = req.user.role;

  await Notification.updateMany(
    {
      read: false,
      $or: [
        { userId },
        { role }
      ]
    },
    { read: true }
  );

  res.status(200).json({
    success: true,
    message: "All notifications marked as read",
  });
});

module.exports = { markAllAsRead };
