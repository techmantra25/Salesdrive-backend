const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const OutletApproved = require("../../models/outletApproved.model");
const notificationQueue = require("../../queues/notificationQueue");

// Helper to fetch recipients
const fetchRecipients = async (Model, recipientIds, sendToAll) => {
  if (sendToAll) {
    return Model.find({ status: true }).select("_id name").lean();
  } 
  return Model.find({ _id: { $in: recipientIds }, status: true }).select("_id name").lean();
};

// Helper to queue notifications in chunks
const queueNotifications = async (recipients, type, title, message, userType, chunkSize = 500) => {
  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);
    const promises = chunk.map(recipient =>
      notificationQueue.add("sendNotification", {
        type,
        data: { title, message },
        userId: recipient._id,
        userType,
      })
    );
    await Promise.all(promises);
  }
};

/**
 * @desc Send notification to distributors or approved outlets
 * @route POST /api/v1/notifications/send
 * @access Admin
 */
const sendNotification = asyncHandler(async (req, res) => {
  const { targetType, recipientIds, sendToAll, title, message, type = "announcement" } = req.body;

  if (!targetType || !["distributor", "outlet"].includes(targetType)) {
    return res.status(400).json({ error: true, message: "Invalid targetType" });
  }

  if (!sendToAll && (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0)) {
    return res.status(400).json({ error: true, message: "Select at least one recipient or use sendToAll" });
  }

  if (!title || !message) {
    return res.status(400).json({ error: true, message: "Title and message are required" });
  }

  if (!["giftOrder", "announcement", "downtime"].includes(type)) {
    return res.status(400).json({ error: true, message: "Invalid type" });
  }

  const Model = targetType === "distributor" ? Distributor : OutletApproved;
  const userType = targetType === "distributor" ? "Distributor" : "OutletApproved";

  const recipients = await fetchRecipients(Model, recipientIds, sendToAll);

  if (!recipients || recipients.length === 0) {
    return res.status(404).json({ error: true, message: "No active recipients found" });
  }

  await queueNotifications(recipients, type, title, message, userType);

  res.status(200).json({
    success: true,
    message: `Notification sent to ${recipients.length} ${targetType}(s)`,
    data: { sentCount: recipients.length, targetType },
  });
});

/**
 * @desc Send bulk notifications with different messages
 * @route POST /api/v1/notifications/send-bulk
 * @access Admin
 */
const sendBulkNotification = asyncHandler(async (req, res) => {
  const { notifications } = req.body;

  if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
    return res.status(400).json({ error: true, message: "notifications array is required" });
  }

  const results = [];

  for (const notif of notifications) {
    const { targetType, recipientIds, sendToAll, title, message, type = "announcement" } = notif;

    if (!targetType || !["distributor", "outlet"].includes(targetType)) {
      results.push({ success: false, error: `Invalid targetType: ${targetType}` });
      continue;
    }

    if (!sendToAll && (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0)) {
      results.push({ success: false, error: "RecipientIds required if sendToAll is false" });
      continue;
    }

    if (!title || !message) {
      results.push({ success: false, error: "Title and message required" });
      continue;
    }

    if (!["giftOrder", "announcement", "downtime"].includes(type)) {
      results.push({ success: false, error: `Invalid type: ${type}` });
      continue;
    }

    const Model = targetType === "distributor" ? Distributor : OutletApproved;
    const userType = targetType === "distributor" ? "Distributor" : "OutletApproved";

    const recipients = await fetchRecipients(Model, recipientIds, sendToAll);

    if (!recipients || recipients.length === 0) {
      results.push({ success: false, error: `No active ${targetType}s found` });
      continue;
    }

    await queueNotifications(recipients, type, title, message, userType);

    results.push({ success: true, sentCount: recipients.length, targetType });
  }

  res.status(200).json({
    success: true,
    message: "Bulk notifications processed",
    data: {
      total: notifications.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    },
  });
});

module.exports = { sendNotification, sendBulkNotification };
