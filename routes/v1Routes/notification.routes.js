const express = require("express");
const router = express.Router();
const { getNotifications } = require("../../controllers/notification/getNotifications");
const { getUnreadCount } = require("../../controllers/notification/getUnreadCount");
const { markAsRead } = require("../../controllers/notification/markAsRead");
const { markAllAsRead } = require("../../controllers/notification/markAllAsRead");
const { deleteNotification } = require("../../controllers/notification/deleteNotification");
const { deleteAllNotifications } = require("../../controllers/notification/deleteAllNotifications");
const { sendNotification, sendBulkNotification } = require("../../controllers/notification/sendNotification");
const notificationQueue = require("../../queues/notificationQueue");

const { protect } = require("../../middlewares/auth.middleware");
const { protectRoute, isAdmin } = require("../../middlewares/protectRoute");

// Queue stats - No auth required (must be before router.use(protect))
router.get("/queue-stats", async (req, res) => {
  try {
    const counts = await notificationQueue.getJobCounts();
    res.status(200).json({
      status: 200,
      data: counts,
    });
  } catch (error) {
    res.status(500).json({
      status: 500,
      error: true,
      message: error.message,
    });
  }
});

// User notification routes (require authentication)
router.use(protect);

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/:id/read", markAsRead);
router.patch("/read-all", markAllAsRead);
router.delete("/:id", deleteNotification);
router.delete("/delete-all", deleteAllNotifications);

// Admin-only notification sending routes
router.post("/send", protectRoute, isAdmin, sendNotification);
router.post("/send-bulk", protectRoute, isAdmin, sendBulkNotification);

module.exports = router;
