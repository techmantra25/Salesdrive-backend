const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const SecondaryTarget = require("../../models/secondaryTarget.model");
const OutletApproved = require("../../models/outletApproved.model");
const SubBrand = require("../../models/subBrand.model");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Zone = require("../../models/zone.model");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const SecondaryTargetSlab = require("../../models/primaryTargetSlab.model");
const notificationQueue = require("../../queues/notificationQueue");
const {generateTargetCode} = require("./utils/secondaryTargetCodeGenerator")

const {
  calculateHistoricalAchievement,
} = require("../../controllers/bill/util/updateSecondaryTargetAchievement");

const createSecondaryTarget = asyncHandler(async (req, res) => {
  try {
    const {
      distributorId,
      retailerId,
      brandIds,
      subBrandIds,
      name,
      target_type,
      target,
      start_date,
      end_date,
    } = req.body;

    // ── 1. Validate distributor ──────────────────────────────────────────────
    const distributor = await Distributor.findById(distributorId).select("brandId dbCode RBPSchemeMapped");
    if (!distributor) {
      res.status(400);
      throw new Error("Distributor does not exist");
    }

    // ── 2. Validate retailer ─────────────────────────────────────────────────
    const retailer = await OutletApproved.findById(retailerId);
    if (!retailer) {
      res.status(400);
      throw new Error("Retailer does not exist");
    }

    // ── 3. Brand validation (optional) ──────────────────────────────────────
    const resolvedBrandIds = [];

    if (brandIds && brandIds.length > 0) {
      const distributorBrandIds = distributor.brandId.map((id) => id.toString());

      const invalidBrands = brandIds.filter(
        (brandId) => !distributorBrandIds.includes(brandId.toString()),
      );

      if (invalidBrands.length > 0) {
        res.status(400);
        throw new Error(
          `Brand IDs ${invalidBrands.join(", ")} do not belong to this distributor`,
        );
      }

      resolvedBrandIds.push(...brandIds);
    }

    // ── 4. SubBrand validation ───────────────────────────────────────────────
    const resolvedSubBrandIds = [];

    if (subBrandIds && subBrandIds.length > 0) {
      if (resolvedBrandIds.length === 0) {
        res.status(400);
        throw new Error("At least one brandId is required when providing subBrandIds");
      }

      const validSubBrands = await SubBrand.find({
        _id:     { $in: subBrandIds },
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

      resolvedSubBrandIds.push(...subBrandIds);
    }

    // ── 5. Unique target name per retailer + distributor ─────────────────────
    const existingTargetName = await SecondaryTarget.findOne({
      distributorId,
      retailerId,
      is_active: true,
      name: { $regex: new RegExp(`^${name}$`, "i") },
    });

    if (existingTargetName) {
      res.status(400);
      throw new Error(
        `Target name "${name}" already exists for this retailer and distributor`,
      );
    }

    // ── 6. Date validations ──────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(start_date);
    if (isNaN(startDate.getTime())) {
      res.status(400);
      throw new Error("Invalid start_date");
    }

    const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);

    if (startDate < startOfCurrentMonth) {
      res.status(400);
      throw new Error("Start date cannot be before the start of the current month");
    }

    const endDate = new Date(end_date);
    if (isNaN(endDate.getTime())) {
      res.status(400);
      throw new Error("Invalid end_date");
    }

    if (endDate < startDate) {
      res.status(400);
      throw new Error("End date cannot be before start date");
    }

    // ── 7. No overlapping target for same retailer + distributor ─────────────
    const overlappingTarget = await SecondaryTarget.findOne({
      distributorId,
      retailerId,
      is_active: true,
      start_date: { $lte: endDate },
      end_date:   { $gte: startDate },
    });

    if (overlappingTarget) {
      res.status(400);
      throw new Error(
        "An active secondary target already exists for this retailer and distributor in the selected date range",
      );
    }

    // ── 8. Target type & value validation ────────────────────────────────────
    if (!["volume", "value"].includes(target_type)) {
      res.status(400);
      throw new Error("Invalid target_type, must be 'volume' or 'value'");
    }

    if (typeof target !== "number" || target < 0) {
      res.status(400);
      throw new Error("Invalid target value");
    }

    // target code generation
    const targetCode = await generateTargetCode();

    console.log(`target code is - ${targetCode}`);

    // ── 9. Create the single target document ─────────────────────────────────
    const secondaryTarget = await SecondaryTarget.create({
      distributorId,
      retailerId,
      brandId:    resolvedBrandIds,
      subBrandId: resolvedSubBrandIds,
      name,
      targetCode,
      target_type,
      target,
      start_date: startDate,
      end_date:   endDate,
      stateId:    retailer.stateId,
      regionId:   retailer.regionId,
    });

    // ── 10. Historical achievement for past-starting targets ─────────────────
    if (startDate < today) {
      const completeTarget = await SecondaryTarget.findById(secondaryTarget._id).lean();
      if (completeTarget) {
        await calculateHistoricalAchievement(completeTarget);
      }
    }

    // ── 11. Send notifications ────────────────────────────────────────────────
    // Determine who created the target
    const hasAdminRole =
      req.user?.role === "admin"      ||
      req.user?.role === "admine"     ||
      req.user?.role === "sub-admins" ||
      req.user?.role === "sales"      ||
      req.user?.role === "user";

    const isDistributor = !hasAdminRole && (req.user?.dbCode || req.user?.role === "GT");
    const isAdmin       = hasAdminRole;

    try {
      // Retailer notification — always send
      const targetValueDisplay =
        target_type === "value"
          ? `Target Value: ₹${target.toLocaleString("en-IN")}`
          : `Target Volume: ${target.toLocaleString("en-IN")} units`;

      const retailerMessage = `A new ${target_type} target "${name}" has been assigned to you. ${targetValueDisplay}`;

      await notificationQueue.add("secondaryTargetAssigned", {
        type: "Target",
        data: {
          message:      retailerMessage,
          title:        "New Target Assigned",
          targetId:     secondaryTarget._id,
          targetName:   name,
          targetType:   target_type,
          targetValue:  target_type === "value"  ? target : null,
          targetVolume: target_type === "volume" ? target : null,
          startDate,
          endDate,
        },
        userId:   retailerId,
        userType: "OutletApproved",
      });

      // If created by DISTRIBUTOR → notify ADMIN
      if (isDistributor) {
        const adminMessage = `New Secondary Target "${name}" created by distributor for ${retailer.outletName} - ${
          target_type === "value"
            ? `₹${target.toLocaleString("en-IN")}`
            : `${target.toLocaleString("en-IN")} units`
        }`;

        await notificationQueue.add("newSecondaryTarget", {
          type: "Target",
          data: {
            message:       adminMessage,
            title:         "New Secondary Target Created",
            targetId:      secondaryTarget._id,
            targetName:    name,
            targetType:    target_type,
            targetValue:   target_type === "value"  ? target : null,
            targetVolume:  target_type === "volume" ? target : null,
            retailerName:  retailer.outletName,
            distributorId,
          },
          userType: "User",
          room:     "role:admin",
        });
      }

      // If created by ADMIN → notify DISTRIBUTOR
      // distributor is already fetched at the top of this controller
      if (isAdmin) {
        const distributorMessage = `A new secondary target "${name}" has been created for retailer ${retailer.outletName} - ${
          target_type === "value"
            ? `₹${target.toLocaleString("en-IN")}`
            : `${target.toLocaleString("en-IN")} units`
        }`;

        await notificationQueue.add("secondaryTargetAssignedDistributor", {
          type: "Target",
          data: {
            message:      distributorMessage,
            title:        "New Secondary Target Created",
            targetId:     secondaryTarget._id,
            targetName:   name,
            targetType:   target_type,
            targetValue:  target_type === "value"  ? target : null,
            targetVolume: target_type === "volume" ? target : null,
            retailerName: retailer.outletName,
          },
          userId:   distributorId,
          userType: "Distributor",
        });
      }
    } catch (notificationError) {
      // Notification failure should never break target creation
      console.error("Notification error in createSecondaryTarget:", notificationError.message);
    }

    // ── 12. Respond ──────────────────────────────────────────────────────────
    res.status(201).json({
      success: true,
      message: "Secondary target created successfully",
      data:    secondaryTarget,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { createSecondaryTarget };