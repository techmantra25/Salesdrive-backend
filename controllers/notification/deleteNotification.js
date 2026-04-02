const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notification.model");

/**
 * @desc Delete a single notification
 * @route DELETE /api/v1/notifications/:id
 * @access Private
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const userId = req.user?._id;
  const role = req.user?.role;

  const notification = await Notification.findById(id);

  if (!notification) {
    return res.status(404).json({
      error: true,
      message: "Notification not found",
    });
  }

  // -------------------------
  // ✅ Admin delete logic
  // -------------------------
  if (role === "admin") {
    if (notification.role !== "admin") {
      return res.status(403).json({
        error: true,
        message: "Not authorized to delete this notification",
      });
    }
  }
  // -------------------------
  // ✅ Normal user delete logic
  // -------------------------
  else {
    if (
      !notification.userId ||
      notification.userId.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        error: true,
        message: "Not authorized to delete this notification",
      });
    }
  }

  await Notification.findByIdAndDelete(id);

  return res.status(200).json({
    success: true,
    message: "Notification deleted successfully",
  });
});

module.exports = { deleteNotification };