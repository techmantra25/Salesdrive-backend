const asyncHandler = require("express-async-handler");
const PrimaryTargetSlab = require("../../models/primaryTargetSlab.model");
const PrimaryTarget = require("../../models/primaryTarget.model");


// ================= SLAB UID LOGIC =================
const getCodeFromDbCode = (dbCode) => {
  if (!dbCode || dbCode.length < 3) return "XX0";

  const firstTwo = dbCode.slice(0, 2).toUpperCase();
  const lastChar = dbCode.slice(-1).toUpperCase();

  return `${firstTwo}${lastChar}`;
};

const generateSlabUid = async (dbCode) => {
  const codePart = getCodeFromDbCode(dbCode);
  const prefix = `SLB-${codePart}`;

  const lastSlab = await PrimaryTargetSlab.findOne({
    slabUid: { $regex: /^SLB-[A-Z0-9]{3}\d{4}$/ },
  })
    .sort({ slabUid: -1 })
    .select("slabUid");

  let nextNumber = 1;

  if (lastSlab?.slabUid) {
    const match = lastSlab.slabUid.match(/(\d{4})$/);

    if (match) {
      const lastNumber = Number(match[1]);

      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
};
// =================================================

const createPrimarySlab = asyncHandler(async (req, res) => {
  try {

    const {
      name,
      slab_type,
      min_range,
      max_range,
      total_percentage,
      discount_percentage,
      targetId,
      targetIds,
      is_active
    } = req.body;

    /* ---------------- BASIC VALIDATION ---------------- */

    if (!name || !slab_type || (!targetId && (!targetIds || targetIds.length === 0))) {
      return res.status(400).json({
        success: false,
        message: "Name, slab type and targetId are required",
      });
    }

    if (!["volume", "value", "percentage"].includes(slab_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid slab type",
      });
    }

    /* ---------------- DUPLICATE NAME CHECK ---------------- */

    const nameExists = await PrimaryTargetSlab.findOne({ name });

    if (nameExists) {
      return res.status(400).json({
        success: false,
        message: "A slab with this name already exists",
      });
    }

    /* ---------------- TARGET LIST NORMALIZE ---------------- */

    let targetsToProcess = [];

    if (targetIds && Array.isArray(targetIds)) {
      targetsToProcess = targetIds;
    } else {
      targetsToProcess = [targetId];
    }

    /* ---------------- SAME SLAB TYPE CHECK FOR TARGET ---------------- */

    for (const currentTargetId of targetsToProcess) {

      const existingSlab = await PrimaryTargetSlab.findOne({ targetId: currentTargetId });

      if (existingSlab && existingSlab.slab_type !== slab_type) {
        return res.status(400).json({
          success: false,
          message: `All slabs for this target must be of type "${existingSlab.slab_type}"`,
        });
      }
    }

    // ✅ FIX: MOVE UID GENERATION HERE
    const firstTarget = await PrimaryTarget.findById(targetsToProcess[0])
      .populate("distributorId", "dbCode");

    if (!firstTarget || !firstTarget.distributorId) {
      return res.status(400).json({
        success: false,
        message: "Invalid target for slab UID generation",
      });
    }

    const slabUid = await generateSlabUid(firstTarget.distributorId.dbCode);

    /* ---------------- BUILD SLAB DATA ---------------- */

    let slabData = {
      name,
      slab_type,
      targetIds: targetsToProcess,
      is_active: is_active ?? true,
      slabUid, // ✅ NOW CORRECT
    };

    /* ---------------- PERCENTAGE SLAB ---------------- */

    if (slab_type === "percentage") {

      if (
        total_percentage === undefined ||
        total_percentage === null
      ) {
        return res.status(400).json({
          success: false,
          message: "total_percentage is required for percentage slab",
        });
      }

      if (
        discount_percentage === undefined ||
        discount_percentage === null
      ) {
        return res.status(400).json({
          success: false,
          message: "discount_percentage is required for percentage slab",
        });
      }

      if (
        typeof total_percentage !== "number" ||
        typeof discount_percentage !== "number"
      ) {
        return res.status(400).json({
          success: false,
          message: "Percentage values must be numbers",
        });
      }

      for (const currentTargetId of targetsToProcess) {

        const existingPercentage = await PrimaryTargetSlab.findOne({
          targetId: currentTargetId,
          slab_type: "percentage",
          total_percentage
        });

        if (existingPercentage) {
          return res.status(400).json({
            success: false,
            message: `total_percentage ${total_percentage}% already exists for this target`
          });
        }
      }

      slabData.total_percentage = total_percentage;
      slabData.discount_percentage = discount_percentage;
    }

    /* ---------------- VALUE / VOLUME SLAB ---------------- */

    else {

      if (
        min_range === undefined ||
        max_range === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "min_range and max_range are required",
        });
      }

      if (
        typeof min_range !== "number" ||
        typeof max_range !== "number"
      ) {
        return res.status(400).json({
          success: false,
          message: "min_range and max_range must be numbers",
        });
      }

      if (min_range >= max_range) {
        return res.status(400).json({
          success: false,
          message: "min_range must be less than max_range",
        });
      }

      for (const currentTargetId of targetsToProcess) {

        const existingSlabs = await PrimaryTargetSlab.find({
          slab_type,
          targetId: currentTargetId
        });

        for (const existing of existingSlabs) {

          const isOverlap =
            min_range <= existing.max_range &&
            max_range >= existing.min_range;

          if (isOverlap) {
            return res.status(400).json({
              success: false,
              message: `Range overlaps with slab "${existing.name}" (${existing.min_range}-${existing.max_range}). New range must start after ${existing.max_range}`
            });
          }
        }

        for (const existing of existingSlabs) {

          const isOverlap =
            min_range < existing.max_range &&
            max_range > existing.min_range;

          if (isOverlap) {
            return res.status(400).json({
              success: false,
              message: `Slab range ${min_range}-${max_range} overlaps with existing slab "${existing.name}" (${existing.min_range}-${existing.max_range})`,
            });
          }
        }
      }

      slabData.min_range = min_range;
      slabData.max_range = max_range;

      if (discount_percentage !== undefined) {
        slabData.discount_percentage = discount_percentage;
      }
    }

    /* ---------------- CREATE SINGLE SLAB ---------------- */

    const newSlab = await PrimaryTargetSlab.create(slabData);

    /* ---------------- UPDATE TARGETS ---------------- */

    await PrimaryTarget.updateMany(
      { _id: { $in: targetsToProcess } },
      {
        $addToSet: { targetSlabId: newSlab._id }
      }
    );

    return res.status(201).json({
      success: true,
      message: "Slab created successfully",
      data: newSlab,
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to create slab",
    });

  }
});

module.exports = { createPrimarySlab };