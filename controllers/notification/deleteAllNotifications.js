const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notification.model");

/**
 * @desc Delete all notifications for authenticated user/admin
 * @route DELETE /api/v1/notifications/delete-all
 * @access Private
 */
const deleteAllNotifications = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const role = req.user?.role;

  let filter = {};

  // -------------------------
  // ✅ Admin delete all
  // -------------------------
  if (role === "admin") {
    filter = { role: "admin" };
  }
  // -------------------------
  // ✅ Normal user delete all
  // -------------------------
  else {
    filter = { userId };
  }

  const result = await Notification.deleteMany(filter);

  return res.status(200).json({
    success: true,
    message: `Successfully deleted ${result.deletedCount} notification(s)`,
    data: {
      deletedCount: result.deletedCount,
    },
  });
});

module.exports = { deleteAllNotifications };