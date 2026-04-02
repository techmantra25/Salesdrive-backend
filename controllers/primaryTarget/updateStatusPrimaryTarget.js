const asyncHandler = require("express-async-handler");
const PrimaryTarget = require("../../models/primaryTarget.model");
const notificationQueue = require("../../queues/notificationQueue");

const updateStatusPrimaryTarget = asyncHandler(async (req, res) => {
  try {
    const { approval_status, reject_reason } = req.body; // Extract approval_status and reject_reason from req.body

    if (approval_status == 'Rejected' && !reject_reason) {
      res.status(400);
      throw new Error("Reject reason is required");
    }

    if (!["Pending", "Approved", "Rejected"].includes(approval_status)) {
      res.status(404);
      throw new Error("Invalid target type, must be 'Pending', 'Approved' or 'Rejected'");
    }

    let primaryTarget = await PrimaryTarget.findById(req.params.ptid);
    if (!primaryTarget) {
      res.status(404);
      throw new Error("Primary target not found");
    }

    const updatedPrimaryTarget = await PrimaryTarget.findOneAndUpdate(
      { _id: req.params.ptid },
      { approval_status, reject_reason },
      { new: true }
    );

    if (updatedPrimaryTarget) {
      // 🔔 Send notification to distributor about target status change
      let statusMessage = "";
      if (approval_status === "Approved") {
        statusMessage = `Your target "${updatedPrimaryTarget.name}" has been approved`;
      } else if (approval_status === "Rejected") {
        statusMessage = `Your target "${updatedPrimaryTarget.name}" has been rejected. Reason: ${reject_reason || "Not specified"}`;
      } else if (approval_status === "Pending") {
        statusMessage = `Your target "${updatedPrimaryTarget.name}" status has been updated to Pending`;
      }
      
      await notificationQueue.add("primaryTargetStatus", {
        type: "Target",
        data: {
          message: statusMessage,
          title: `Target ${approval_status}`,
          targetId: updatedPrimaryTarget._id,
          targetName: updatedPrimaryTarget.name,
          approvalStatus: approval_status,
          rejectReason: reject_reason || null,
        },
        userId: updatedPrimaryTarget.distributorId,
        userType: "Distributor",
      });

      return res.status(201).json({
        status: 201,
        message: "Primary target updated successfully",
        data: updatedPrimaryTarget,
      });
    } else {
      res.status(500);
      throw new Error("Primary target not updated");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateStatusPrimaryTarget };
