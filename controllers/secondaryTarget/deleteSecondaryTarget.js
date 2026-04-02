const asyncHandler = require("express-async-handler");
const SecondaryTarget = require("../../models/secondaryTarget.model");
const SecondaryTargetSlab = require("../../models/secondaryTargetSlab.model");
const Bill = require("../../models/bill.model");
const OutletApproved = require("../../models/outletApproved.model");
const notificationQueue = require("../../queues/notificationQueue");

const deleteSecondaryTarget = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const existingTarget = await SecondaryTarget.findById(id).lean();
    if (!existingTarget) {
      res.status(404);
      throw new Error("Secondary Target not found");
    }

   
    if (existingTarget.targetSlabId && existingTarget.targetSlabId.length > 0) {
      await SecondaryTargetSlab.updateMany(
        { _id: { $in: existingTarget.targetSlabId } },
        { $pull: { targets: existingTarget._id } },
      );
      console.log(
        `Removed target "${existingTarget.name}" from ${existingTarget.targetSlabId.length} slab(s)`,
      );
    }

    // ── 2. Free all bills that were linked to this target ─────────────────
    // Bills store a single targetId reference — set it back to null
    const billUpdateResult = await Bill.updateMany(
      { targetId: existingTarget._id },
      { $set: { targetId: null } },
    );

    console.log(
      `Freed ${billUpdateResult.modifiedCount} bill(s) from target "${existingTarget.name}"`,
    );

    // ── 3. Delete the target ──────────────────────────────────────────────
    // await SecondaryTarget.findByIdAndDelete(id);

    // soft delete
    await SecondaryTarget.findByIdAndUpdate(id, { $set: { is_active: false } });

    // 🔔 Send notifications based on who deleted the target
    // Check if user has admin role (User model has role field)
    // Distributor model doesn't have these admin roles
    const hasAdminRole = req.user?.role === "admin" || req.user?.role === "admine" || req.user?.role === "sub-admins" || req.user?.role === "sales" || req.user?.role === "user";
    
    // If role is undefined, check for distributor-specific fields
    const isDistributor = !hasAdminRole && (req.user?.dbCode || req.user?.role === "GT");
    const isAdmin = hasAdminRole;

    // Fetch retailer for notification
    const retailer = await OutletApproved.findById(existingTarget.retailerId);

    // Retailer notification (user-specific) - always send
    const retailerMessage = `Your secondary target "${existingTarget.name}" has been deleted`;
    
    await notificationQueue.add("secondaryTargetDeleteRetailer", {
      type: "Target",
      data: {
        message: retailerMessage,
        title: "Target Deleted",
        targetId: existingTarget._id,
        targetName: existingTarget.name,
      },
      userId: existingTarget.retailerId,
      userType: "OutletApproved",
    });

    // If deleted by DISTRIBUTOR → send notification to ADMIN
    if (isDistributor) {
      const adminMessage = `Secondary Target "${existingTarget.name}" has been deleted by distributor for ${retailer?.outletName || 'retailer'}`;
      
      await notificationQueue.add("secondaryTargetDelete", {
        type: "Target",
        data: {
          message: adminMessage,
          title: "Secondary Target Deleted",
          targetId: existingTarget._id,
          targetName: existingTarget.name,
          retailerName: retailer?.outletName,
          distributorId: existingTarget.distributorId,
        },
        userType: "User",
        room: "role:admin",
      });
    }

    // If deleted by ADMIN → send notification to DISTRIBUTOR
    if (isAdmin) {
      const distributorMessage = `Secondary target "${existingTarget.name}" for retailer ${retailer?.outletName || 'retailer'} has been deleted by admin`;
      
      await notificationQueue.add("secondaryTargetDeleteDistributor", {
        type: "Target",
        data: {
          message: distributorMessage,
          title: "Secondary Target Deleted",
          targetId: existingTarget._id,
          targetName: existingTarget.name,
          retailerName: retailer?.outletName,
        },
        userId: existingTarget.distributorId,
        userType: "Distributor",
      });
    }

    res.status(200).json({
      success: true,
      message: "Secondary target deleted successfully",
      data: {
        deletedTargetId:   id,
        deletedTargetName: existingTarget.name,
        slabsFreed:        existingTarget.targetSlabId?.length || 0,
        billsFreed:        billUpdateResult.modifiedCount,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw new Error(error?.message || "Failed to delete secondary target");
  }
});

module.exports = { deleteSecondaryTarget };