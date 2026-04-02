const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const SecondaryTarget = require("../../models/secondaryTarget.model");
const OutletApproved = require("../../models/outletApproved.model");
const SecondaryTargetSlab = require("../../models/primaryTargetSlab.model");
const Brand = require("../../models/brand.model");
const SubBrand = require("../../models/subBrand.model");
const notificationQueue = require("../../queues/notificationQueue");

const {
  recalculateAfterTargetEdit,
} = require("../../controllers/bill/util/updateSecondaryTargetAchievement");

// ── Main controller ───────────────────────────────────────────────────────────
const editSecondaryTarget = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brandIds, subBrandIds, start_date, end_date, target } =
      req.body;

    /* -------------------- FETCH EXISTING TARGET -------------------- */
    const existingTarget = await SecondaryTarget.findById(id).lean();

    if (!existingTarget) {
      res.status(404);
      throw new Error("Secondary target not found");
    }

    // A target that has already ended cannot be edited
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (existingTarget.end_date < today) {
      res.status(400);
      throw new Error("You cannot edit a target that has already ended");
    }

    // Distributor, retailer and target type are locked
    const distributorId = existingTarget.distributorId;
    const retailerId = existingTarget.retailerId;
    const target_type = existingTarget.target_type;

    /* -------------------- NAME VALIDATION -------------------- */
    if (name !== undefined) {
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400);
        throw new Error("Invalid target name");
      }

      const duplicateName = await SecondaryTarget.findOne({
        _id: { $ne: id },
        distributorId,
        retailerId,
        is_active:    true,
        name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      });

      if (duplicateName) {
        res.status(400);
        throw new Error(
          `Target name "${name}" already exists for this retailer and distributor`,
        );
      }
    }

    /* -------------------- BRAND VALIDATION -------------------- */
    let resolvedBrandIds = existingTarget.brandId.map((id) => id.toString());

    if (brandIds !== undefined) {
      if (!Array.isArray(brandIds)) {
        res.status(400);
        throw new Error("brandIds must be an array");
      }

      if (brandIds.length > 0) {
        const distributor =
          await Distributor.findById(distributorId).select("brandId");
        if (!distributor) {
          res.status(400);
          throw new Error("Distributor not found");
        }

        const distributorBrandIds = distributor.brandId.map((bid) =>
          bid.toString(),
        );
        const invalidBrands = brandIds.filter(
          (bid) => !distributorBrandIds.includes(bid.toString()),
        );

        if (invalidBrands.length > 0) {
          res.status(400);
          throw new Error(
            `Brand IDs ${invalidBrands.join(", ")} do not belong to this distributor`,
          );
        }
      }

      resolvedBrandIds = brandIds.map((bid) => bid.toString());
    }

    /* -------------------- SUBBRAND VALIDATION -------------------- */
    // subBrandIds is only processed if explicitly sent in the request
    // if not sent (undefined) — keep existing subBrands unchanged
    let resolvedSubBrandIds = existingTarget.subBrandId.map((id) =>
      id.toString(),
    );

    if (subBrandIds !== undefined) {
      if (!Array.isArray(subBrandIds)) {
        res.status(400);
        throw new Error("subBrandIds must be an array");
      }

      if (subBrandIds.length > 0) {
        if (resolvedBrandIds.length === 0) {
          res.status(400);
          throw new Error(
            "At least one brand is required when providing subBrandIds",
          );
        }

        const validSubBrands = await SubBrand.find({
          _id: { $in: subBrandIds },
          brandId: { $in: resolvedBrandIds },
        }).select("_id");

        const validSubBrandIds = validSubBrands.map((sb) => sb._id.toString());
        const invalidSubBrands = subBrandIds.filter(
          (sbId) => !validSubBrandIds.includes(sbId.toString()),
        );

        if (invalidSubBrands.length > 0) {
          res.status(400);
          throw new Error(
            `SubBrand IDs ${invalidSubBrands.join(", ")} do not belong to any of the provided brands`,
          );
        }
      }

      resolvedSubBrandIds = subBrandIds.map((sbId) => sbId.toString());
    }

    /* -------------------- DATE VALIDATION -------------------- */
    let startDate = existingTarget.start_date;
    let endDate = existingTarget.end_date;

    if (start_date) {
      startDate = new Date(start_date);
      if (isNaN(startDate.getTime())) {
        res.status(400);
        throw new Error("Invalid start date");
      }

      const startOfCurrentMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      );
      startOfCurrentMonth.setHours(0, 0, 0, 0);

      if (startDate < startOfCurrentMonth) {
        res.status(400);
        throw new Error(
          "Start date cannot be before the start of the current month",
        );
      }
    }

    if (end_date) {
      endDate = new Date(end_date);
      if (isNaN(endDate.getTime())) {
        res.status(400);
        throw new Error("Invalid end date");
      }
    }

    if (endDate < startDate) {
      res.status(400);
      throw new Error("End date cannot be before start date");
    }

    /* -------------------- OVERLAP CHECK -------------------- */
    const overlappingTarget = await SecondaryTarget.findOne({
      _id: { $ne: id },
      distributorId,
      retailerId,
      target_type,
      start_date: { $lte: endDate },
      end_date: { $gte: startDate },
    });

    if (overlappingTarget) {
      res.status(400);
      throw new Error(
        `Another ${target_type} target already exists for this retailer and distributor in the selected date range`,
      );
    }

    /* -------------------- TARGET VALUE VALIDATION -------------------- */
    let resolvedTarget = existingTarget.target;

    if (target !== undefined) {
      if (typeof target !== "number" || target < 0) {
        res.status(400);
        throw new Error("Invalid target value — must be a non-negative number");
      }
      resolvedTarget = target;
    }

    const targetChanged = target !== undefined && target !== existingTarget.target;

    /* -------------------- DETECT WHAT CHANGED -------------------- */
    const existingBrandIds = existingTarget.brandId
      .map((id) => id.toString())
      .sort();
    const existingSubBrandIds = existingTarget.subBrandId
      .map((id) => id.toString())
      .sort();

    const newBrandIds = [...resolvedBrandIds].sort();
    const newSubBrandIds = [...resolvedSubBrandIds].sort();

    const brandsChanged =
      JSON.stringify(existingBrandIds) !== JSON.stringify(newBrandIds);

    const subBrandsChanged =
      JSON.stringify(existingSubBrandIds) !== JSON.stringify(newSubBrandIds);

    const datesChanged =
      (start_date &&
        new Date(start_date).getTime() !==
          existingTarget.start_date.getTime()) ||
      (end_date &&
        new Date(end_date).getTime() !== existingTarget.end_date.getTime());

   const needsRecalculation = brandsChanged || subBrandsChanged || datesChanged || targetChanged;

    /* -------------------- APPLY UPDATES -------------------- */
    const updateFields = {
      brandId: resolvedBrandIds,
      subBrandId: resolvedSubBrandIds,
      start_date: startDate,
      end_date: endDate,
      target:     resolvedTarget,
    };

    if (name !== undefined) updateFields.name = name.trim();

    // Save updated fields first — recalculate AFTER so it uses new brands/dates
    const updatedTarget = await SecondaryTarget.findByIdAndUpdate(
      id,
      updateFields,
      { new: true },
    );

    // Recalculate whenever brands, subBrands or dates changed
    // recalculateAfterTargetEdit handles all cases internally:
    // - future start date → resets to 0 and stops (no bills to process)
    // - past/current start date → resets and recalculates from bills in the new date range
    if (needsRecalculation) {
      await recalculateAfterTargetEdit(id);
    }

    /* -------------------- SEND NOTIFICATIONS -------------------- */
    // Wrapped in try/catch so notification failure never breaks the edit response
    try {
      const retailer = await OutletApproved.findById(
        updatedTarget.retailerId,
      ).lean();

      const hasAdminRole =
        req.user?.role === "admin" ||
        req.user?.role === "admine" ||
        req.user?.role === "sub-admins" ||
        req.user?.role === "sales" ||
        req.user?.role === "user";

      const isDistributor =
        !hasAdminRole && (req.user?.dbCode || req.user?.role === "GT");
      const isAdmin = hasAdminRole;

      const targetValueDisplay =
        updatedTarget.target_type === "value"
          ? `New Target Value: ₹${updatedTarget.target.toLocaleString("en-IN")}`
          : `New Target Volume: ${updatedTarget.target.toLocaleString("en-IN")} units`;

      // Retailer notification — always send
      const retailerMessage = `Your ${updatedTarget.target_type} target "${updatedTarget.name}" has been updated. ${targetValueDisplay}`;

      await notificationQueue.add("secondaryTargetUpdateRetailer", {
        type: "Target",
        data: {
          message: retailerMessage,
          title: "Target Updated",
          targetId: updatedTarget._id,
          targetName: updatedTarget.name,
          targetType: updatedTarget.target_type,
          targetValue:
            updatedTarget.target_type === "value" ? updatedTarget.target : null,
          targetVolume:
            updatedTarget.target_type === "volume"
              ? updatedTarget.target
              : null,
          startDate: updatedTarget.start_date,
          endDate: updatedTarget.end_date,
        },
        userId: updatedTarget.retailerId,
        userType: "OutletApproved",
      });

      // If updated by DISTRIBUTOR → notify ADMIN
      if (isDistributor) {
        const adminMessage = `Secondary Target "${updatedTarget.name}" has been updated by distributor for ${retailer?.outletName || "retailer"} - ${
          updatedTarget.target_type === "value"
            ? `₹${updatedTarget.target.toLocaleString("en-IN")}`
            : `${updatedTarget.target.toLocaleString("en-IN")} units`
        }`;

        await notificationQueue.add("secondaryTargetUpdate", {
          type: "Target",
          data: {
            message: adminMessage,
            title: "Secondary Target Updated",
            targetId: updatedTarget._id,
            targetName: updatedTarget.name,
            targetType: updatedTarget.target_type,
            targetValue:
              updatedTarget.target_type === "value"
                ? updatedTarget.target
                : null,
            targetVolume:
              updatedTarget.target_type === "volume"
                ? updatedTarget.target
                : null,
            retailerName: retailer?.outletName,
            distributorId: updatedTarget.distributorId,
          },
          userType: "User",
          room: "role:admin",
        });
      }

      // If updated by ADMIN → notify DISTRIBUTOR
      if (isAdmin) {
        const distributorMessage = `Secondary target "${updatedTarget.name}" for retailer ${retailer?.outletName || "retailer"} has been updated by admin. ${targetValueDisplay}`;

        await notificationQueue.add("secondaryTargetUpdateDistributor", {
          type: "Target",
          data: {
            message: distributorMessage,
            title: "Secondary Target Updated",
            targetId: updatedTarget._id,
            targetName: updatedTarget.name,
            targetType: updatedTarget.target_type,
            targetValue:
              updatedTarget.target_type === "value"
                ? updatedTarget.target
                : null,
            targetVolume:
              updatedTarget.target_type === "volume"
                ? updatedTarget.target
                : null,
            retailerName: retailer?.outletName,
          },
          userId: updatedTarget.distributorId,
          userType: "Distributor",
        });
      }
    } catch (notificationError) {
      console.error(
        "Notification error in editSecondaryTarget:",
        notificationError.message,
      );
    }

    /* -------------------- RESPOND -------------------- */
    res.status(200).json({
      success: true,
      message: "Secondary target updated successfully",
      data: updatedTarget,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { editSecondaryTarget };
