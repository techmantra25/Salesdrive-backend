const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notification.model");

/**
 * @desc Mark single notification as read
 * @route PATCH /api/v1/notifications/:id/read
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const role = req.user.role;

  const notification = await Notification.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { userId },
        { role }
      ]
    },
    { read: true },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Notification marked as read",
  });
});

module.exports = { markAsRead };
