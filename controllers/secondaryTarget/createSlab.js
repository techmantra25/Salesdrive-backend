const asyncHandler = require("express-async-handler");
const SecondaryTargetSlab = require("../../models/secondaryTargetSlab.model");
const SecondaryTarget = require("../../models/secondaryTarget.model");

const {
  generateSlabCode,
} = require("./utils/secondaryTargetSlabCodeGenerator");

// ── Recalculate current slab for a single target ──────────────────────────────
// Called after create, edit, or delete to reassign the best fitting slab to each affected target
const recalculateTargetSlab = async (targetId) => {
  try {
    const target = await SecondaryTarget.findById(targetId).lean();
    if (!target) {
      console.log(`Target ${targetId} not found during slab recalculation`);
      return;
    }

    // No slabs mapped to this target at all — clear and return
    if (!target.targetSlabId || target.targetSlabId.length === 0) {
      await SecondaryTarget.findByIdAndUpdate(targetId, {
        currentTargetSlabId: null,
      });
      return;
    }

    // Fetch all active slabs mapped to this target
    const mappedSlabs = await SecondaryTargetSlab.find({
      _id: { $in: target.targetSlabId },
      is_active: true,
    }).lean();

    // No active slabs found — clear and return
    if (!mappedSlabs || mappedSlabs.length === 0) {
      await SecondaryTarget.findByIdAndUpdate(targetId, {
        currentTargetSlabId: null,
      });
      return;
    }

    const totalAchievement = target.achivedTarget || 0;
    const slabType = mappedSlabs[0].slab_type;
    let matchedSlab = null;

    // volume/value — find slab where achievement falls in min/max range
    if (slabType === "volume" || slabType === "value") {
      matchedSlab =
        mappedSlabs.find(
          (s) =>
            totalAchievement >= s.min_range && totalAchievement <= s.max_range,
        ) || null;
    }

    // percentage — find highest qualifying slab based on achievement %
    // if achievement is 0 or below all slabs, no slab will be assigned which is correct
    if (slabType === "percentage") {
      const achievementPercentage =
        target.target > 0 ? (totalAchievement / target.target) * 100 : 0;

      const qualifiedSlabs = mappedSlabs
        .sort((a, b) => a.perc_slab - b.perc_slab)
        .filter((s) => achievementPercentage >= s.perc_slab);

      matchedSlab =
        qualifiedSlabs.length > 0
          ? qualifiedSlabs[qualifiedSlabs.length - 1]
          : null;
    }

    await SecondaryTarget.findByIdAndUpdate(targetId, {
      currentTargetSlabId: matchedSlab ? matchedSlab._id : null,
    });

    console.log(
      `Recalculated slab for target "${target.name}": ${matchedSlab ? matchedSlab.name : "No slab (achievement not yet in any slab range)"}`,
    );
  } catch (error) {
    console.error(
      `Error recalculating slab for target ${targetId}:`,
      error.message,
    );
  }
};

// ── Create Slab ───────────────────────────────────────────────────────────────
const createSlab = asyncHandler(async (req, res) => {
  try {
    const {
      name,
      slab_type,
      min_range,
      max_range,
      perc_slab,
      discount,
      is_active,
      targetIds, // array of SecondaryTarget IDs to map to this slab
    } = req.body;

    /* -------------------- BASIC FIELD VALIDATIONS -------------------- */
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Slab name is required" });
    }

    if (!["volume", "value", "percentage"].includes(slab_type)) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Invalid slab type, must be 'volume', 'value', or 'percentage'",
        });
    }

    // volume/value → min_range and max_range required, perc_slab not needed
    if (slab_type === "volume" || slab_type === "value") {
      if (min_range === undefined || max_range === undefined) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "min_range and max_range are required for volume/value slabs",
          });
      }

      if (typeof min_range !== "number" || typeof max_range !== "number") {
        return res
          .status(400)
          .json({
            success: false,
            message: "min_range and max_range must be numbers",
          });
      }

      if (min_range >= max_range) {
        return res
          .status(400)
          .json({
            success: false,
            message: "min_range must be less than max_range",
          });
      }
    }

    // percentage → perc_slab required, min_range/max_range not needed
    if (slab_type === "percentage") {
      if (perc_slab === undefined) {
        return res
          .status(400)
          .json({
            success: false,
            message: "perc_slab is required for percentage slabs",
          });
      }

      if (typeof perc_slab !== "number" || perc_slab < 0) {
        return res
          .status(400)
          .json({
            success: false,
            message: "perc_slab must be a non-negative number",
          });
      }
    }

    // discount is optional but if provided must be valid
    if (discount !== undefined) {
      if (typeof discount !== "number" || discount < 0 || discount > 100) {
        return res
          .status(400)
          .json({
            success: false,
            message: "discount must be a number between 0 and 100",
          });
      }
    }

    /* -------------------- DUPLICATE NAME CHECK -------------------- */
    // const nameExists = await SecondaryTargetSlab.findOne({ name });
    // if (nameExists) {
    //   return res.status(400).json({ success: false, message: "A slab with this name already exists" });
    // }

    /* -------------------- TARGET VALIDATIONS -------------------- */
    // targets are optional at creation — slab can exist with no targets initially
    const resolvedTargetIds = [];

    if (targetIds && targetIds.length > 0) {
      const targets = await SecondaryTarget.find({
        _id: { $in: targetIds },
      }).lean();

      if (targets.length !== targetIds.length) {
        const foundIds = targets.map((t) => t._id.toString());
        const notFoundIds = targetIds.filter(
          (id) => !foundIds.includes(id.toString()),
        );
        return res
          .status(400)
          .json({
            success: false,
            message: `Target ID(s) not found: ${notFoundIds.join(", ")}`,
          });
      }

      // volume/value slabs — targets must match the slab type
      if (slab_type === "volume" || slab_type === "value") {
        const wrongTypeTargets = targets.filter(
          (t) => t.target_type !== slab_type,
        );
        if (wrongTypeTargets.length > 0) {
          const wrongNames = wrongTypeTargets.map((t) => t.name);
          return res.status(400).json({
            success: false,
            message: `Targets [${wrongNames.join(", ")}] are not of type '${slab_type}'. Volume/value slabs can only be mapped to matching target types`,
          });
        }
      }

      for (const target of targets) {
        // Only run consistency and overlap checks if target already has slabs mapped
        // if targetSlabId is empty there is no prior mapping to be consistent with
        if (target.targetSlabId && target.targetSlabId.length > 0) {
          const existingTargetSlabs = await SecondaryTargetSlab.find({
            _id: { $in: target.targetSlabId },
            is_active: true,
          }).lean();

          if (existingTargetSlabs.length > 0) {
            // Mapping consistency check
            const existingSlabType = existingTargetSlabs[0].slab_type;
            const existingMappingCombo = `${target.target_type}-${existingSlabType}`;
            const newMappingCombo = `${target.target_type}-${slab_type}`;

            if (existingMappingCombo !== newMappingCombo) {
              return res.status(400).json({
                success: false,
                message: `Target "${target.name}" is already mapped as '${existingMappingCombo}'. Cannot change mapping to '${newMappingCombo}'`,
              });
            }

            // Overlap check against target's existing slabs
            for (const existing of existingTargetSlabs) {
              if (slab_type === "volume" || slab_type === "value") {
                const isOverlap =
                  min_range < existing.max_range &&
                  max_range > existing.min_range;

                if (isOverlap) {
                  return res.status(400).json({
                    success: false,
                    message: `Slab range ${min_range}-${max_range} overlaps with slab "${existing.name}" (${existing.min_range}-${existing.max_range}) already mapped to target "${target.name}"`,
                  });
                }
              }

              if (slab_type === "percentage") {
                if (existing.perc_slab === perc_slab) {
                  return res.status(400).json({
                    success: false,
                    message: `A percentage slab with ${perc_slab}% already exists for target "${target.name}" (slab: "${existing.name}")`,
                  });
                }
              }
            }
          }
        }
        // if targetSlabId is empty — no prior mapping, skip consistency check and proceed

        resolvedTargetIds.push(target._id);
      }
    }

    /* -------------------- CREATE SLAB -------------------- */

    // generate code for the slab
    const slabCode = await generateSlabCode();

    const slabData = {
      name,
      slabCode,
      slab_type,
      is_active: is_active ?? true,
      targets: resolvedTargetIds,
    };

    if (discount !== undefined) slabData.discount = discount;
    if (slab_type === "volume" || slab_type === "value") {
      slabData.min_range = min_range;
      slabData.max_range = max_range;
    }
    if (slab_type === "percentage") slabData.perc_slab = perc_slab;

    const newSlab = await SecondaryTargetSlab.create(slabData);

    // Push this slab into each target's targetSlabId array
    if (resolvedTargetIds.length > 0) {
      await SecondaryTarget.updateMany(
        { _id: { $in: resolvedTargetIds } },
        { $addToSet: { targetSlabId: newSlab._id } },
      );

      // Recalculate slab assignment for each mapped target
      for (const targetId of resolvedTargetIds) {
        await recalculateTargetSlab(targetId.toString());
      }
    }

    return res.status(201).json({
      success: true,
      message: "Slab created successfully",
      data: newSlab,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to create slab" });
  }
});

// ── Edit Slab ─────────────────────────────────────────────────────────────────
const editSlab = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      min_range,
      max_range,
      perc_slab,
      discount,
      is_active,
      addTargetIds, // array of target IDs to add to this slab
      removeTargetIds, // array of target IDs to remove from this slab
    } = req.body;

    /* -------------------- FETCH EXISTING SLAB -------------------- */
    const existingSlab = await SecondaryTargetSlab.findById(id).lean();
    if (!existingSlab) {
      return res
        .status(404)
        .json({ success: false, message: "Slab not found" });
    }

    // slab_type is NOT editable — use the existing one throughout
    const slab_type = existingSlab.slab_type;

    /* -------------------- NAME VALIDATION -------------------- */
    if (name !== undefined) {
      if (!name || typeof name !== "string") {
        return res
          .status(400)
          .json({ success: false, message: "Invalid slab name" });
      }

      // const nameExists = await SecondaryTargetSlab.findOne({ name, _id: { $ne: id } });
      // if (nameExists) {
      //   return res.status(400).json({ success: false, message: "A slab with this name already exists" });
      // }
    }

    /* -------------------- RANGE / PERCENTAGE VALIDATIONS -------------------- */
    // Resolve final values — fall back to existing if not provided
    const finalMinRange =
      min_range !== undefined ? min_range : existingSlab.min_range;
    const finalMaxRange =
      max_range !== undefined ? max_range : existingSlab.max_range;
    const finalPercSlab =
      perc_slab !== undefined ? perc_slab : existingSlab.perc_slab;

    if (slab_type === "volume" || slab_type === "value") {
      if (
        typeof finalMinRange !== "number" ||
        typeof finalMaxRange !== "number"
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message: "min_range and max_range must be numbers",
          });
      }

      if (finalMinRange >= finalMaxRange) {
        return res
          .status(400)
          .json({
            success: false,
            message: "min_range must be less than max_range",
          });
      }

      // Per-target overlap check against all other slabs on each currently mapped target
      const mappedTargetIds = existingSlab.targets || [];

      for (const targetId of mappedTargetIds) {
        const target = await SecondaryTarget.findById(targetId)
          .select("targetSlabId name")
          .lean();

        if (!target) continue;

        const otherSlabs = await SecondaryTargetSlab.find({
          _id: { $in: target.targetSlabId, $ne: id },
          slab_type: { $in: ["volume", "value"] },
          is_active: true,
        }).lean();

        for (const other of otherSlabs) {
          const isOverlap =
            finalMinRange < other.max_range && finalMaxRange > other.min_range;

          if (isOverlap) {
            return res.status(400).json({
              success: false,
              message: `Updated range ${finalMinRange}-${finalMaxRange} overlaps with slab "${other.name}" (${other.min_range}-${other.max_range}) on target "${target.name}"`,
            });
          }
        }
      }
    }

    if (slab_type === "percentage") {
      if (
        finalPercSlab === undefined ||
        typeof finalPercSlab !== "number" ||
        finalPercSlab < 0
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message: "perc_slab must be a non-negative number",
          });
      }

      // Per-target duplicate percentage check
      const mappedTargetIds = existingSlab.targets || [];

      for (const targetId of mappedTargetIds) {
        const target = await SecondaryTarget.findById(targetId)
          .select("targetSlabId name")
          .lean();

        if (!target) continue;

        const otherSlabs = await SecondaryTargetSlab.find({
          _id: { $in: target.targetSlabId, $ne: id },
          slab_type: "percentage",
          is_active: true,
        }).lean();

        const duplicate = otherSlabs.find((s) => s.perc_slab === finalPercSlab);
        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: `Percentage ${finalPercSlab}% already exists on target "${target.name}" via slab "${duplicate.name}"`,
          });
        }
      }
    }

    /* -------------------- DISCOUNT VALIDATION -------------------- */
    if (discount !== undefined) {
      if (typeof discount !== "number" || discount < 0 || discount > 100) {
        return res
          .status(400)
          .json({
            success: false,
            message: "discount must be a number between 0 and 100",
          });
      }
    }

    /* -------------------- ADD NEW TARGETS VALIDATION -------------------- */
    if (addTargetIds && addTargetIds.length > 0) {
      const targetsToAdd = await SecondaryTarget.find({
        _id: { $in: addTargetIds },
      }).lean();

      if (targetsToAdd.length !== addTargetIds.length) {
        const foundIds = targetsToAdd.map((t) => t._id.toString());
        const notFoundIds = addTargetIds.filter(
          (tid) => !foundIds.includes(tid.toString()),
        );
        return res
          .status(400)
          .json({
            success: false,
            message: `Target ID(s) not found: ${notFoundIds.join(", ")}`,
          });
      }

      // volume/value slabs — targets must match slab type
      if (slab_type === "volume" || slab_type === "value") {
        const wrongTypeTargets = targetsToAdd.filter(
          (t) => t.target_type !== slab_type,
        );
        if (wrongTypeTargets.length > 0) {
          const wrongNames = wrongTypeTargets.map((t) => t.name);
          return res.status(400).json({
            success: false,
            message: `Targets [${wrongNames.join(", ")}] are not of type '${slab_type}'`,
          });
        }
      }

      // Mapping consistency + overlap checks — same logic as createSlab
      for (const target of targetsToAdd) {
        // Only run if target already has slabs mapped
        if (target.targetSlabId && target.targetSlabId.length > 0) {
          const existingTargetSlabs = await SecondaryTargetSlab.find({
            _id: { $in: target.targetSlabId },
            is_active: true,
          }).lean();

          if (existingTargetSlabs.length > 0) {
            const existingSlabType = existingTargetSlabs[0].slab_type;
            const existingMappingCombo = `${target.target_type}-${existingSlabType}`;
            const newMappingCombo = `${target.target_type}-${slab_type}`;

            if (existingMappingCombo !== newMappingCombo) {
              return res.status(400).json({
                success: false,
                message: `Target "${target.name}" is already mapped as '${existingMappingCombo}'. Cannot change mapping to '${newMappingCombo}'`,
              });
            }

            for (const existing of existingTargetSlabs) {
              if (slab_type === "volume" || slab_type === "value") {
                const isOverlap =
                  finalMinRange < existing.max_range &&
                  finalMaxRange > existing.min_range;

                if (isOverlap) {
                  return res.status(400).json({
                    success: false,
                    message: `Slab range ${finalMinRange}-${finalMaxRange} overlaps with slab "${existing.name}" (${existing.min_range}-${existing.max_range}) already mapped to target "${target.name}"`,
                  });
                }
              }

              if (slab_type === "percentage") {
                if (existing.perc_slab === finalPercSlab) {
                  return res.status(400).json({
                    success: false,
                    message: `Percentage ${finalPercSlab}% already exists for target "${target.name}" via slab "${existing.name}"`,
                  });
                }
              }
            }
          }
        }
        // if targetSlabId is empty — no prior mapping, skip consistency check and proceed
      }
    }

    /* -------------------- APPLY UPDATES -------------------- */
    // Use $set for all scalar fields to avoid mixing operators with top-level fields
    const setFields = {
      is_active: is_active ?? existingSlab.is_active,
    };

    if (name !== undefined) setFields.name = name;
    if (discount !== undefined) setFields.discount = discount;

    if (slab_type === "volume" || slab_type === "value") {
      setFields.min_range = finalMinRange;
      setFields.max_range = finalMaxRange;
    }

    if (slab_type === "percentage") {
      setFields.perc_slab = finalPercSlab;
    }

    await SecondaryTargetSlab.findByIdAndUpdate(id, { $set: setFields });

    // Add new target refs to slab and back-link on target — separate op to avoid operator conflict
    if (addTargetIds && addTargetIds.length > 0) {
      await SecondaryTargetSlab.findByIdAndUpdate(id, {
        $addToSet: { targets: { $each: addTargetIds } },
      });

      await SecondaryTarget.updateMany(
        { _id: { $in: addTargetIds } },
        { $addToSet: { targetSlabId: id } },
      );
    }

    // Remove target refs from slab and remove back-link on target — separate op
    if (removeTargetIds && removeTargetIds.length > 0) {
      await SecondaryTargetSlab.findByIdAndUpdate(id, {
        $pull: { targets: { $in: removeTargetIds } },
      });

      await SecondaryTarget.updateMany(
        { _id: { $in: removeTargetIds } },
        { $pull: { targetSlabId: id } },
      );
    }

    /* -------------------- RECALCULATE AFFECTED TARGETS -------------------- */
    // Re-fetch to get the final targets list after all add/remove ops
    const finalSlab = await SecondaryTargetSlab.findById(id).lean();

    const allAffectedTargetIds = [
      ...(finalSlab.targets || []).map((t) => t.toString()),
      ...(removeTargetIds || []).map((t) => t.toString()),
    ];

    const uniqueAffectedIds = [...new Set(allAffectedTargetIds)];

    for (const targetId of uniqueAffectedIds) {
      await recalculateTargetSlab(targetId);
    }

    return res.status(200).json({
      success: true,
      message: "Slab updated successfully",
      data: finalSlab,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update slab" });
  }
});

// ── Delete Slab ───────────────────────────────────────────────────────────────
const deleteSlab = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const slab = await SecondaryTargetSlab.findById(id).lean();
    if (!slab) {
      return res
        .status(404)
        .json({ success: false, message: "Slab not found" });
    }

    // Capture affected targets before deleting
    const affectedTargetIds = (slab.targets || []).map((t) => t.toString());

    // Remove this slab's reference from all mapped targets
    if (affectedTargetIds.length > 0) {
      await SecondaryTarget.updateMany(
        { _id: { $in: affectedTargetIds } },
        { $pull: { targetSlabId: slab._id } },
      );
    }

    await SecondaryTargetSlab.findByIdAndDelete(id);

    // Recalculate slab assignment for all previously mapped targets
    for (const targetId of affectedTargetIds) {
      await recalculateTargetSlab(targetId);
    }

    return res.status(200).json({
      success: true,
      message: "Slab deleted successfully",
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete slab" });
  }
});

module.exports = { createSlab, editSlab, deleteSlab, recalculateTargetSlab };
