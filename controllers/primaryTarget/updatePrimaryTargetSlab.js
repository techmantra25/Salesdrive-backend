const asyncHandler = require("express-async-handler");
const PrimaryTargetSlab = require("../../models/primaryTargetSlab.model");
const PrimaryTarget = require("../../models/primaryTarget.model");

/* ----------------------------------------
   EDIT PRIMARY TARGET SLAB
---------------------------------------- */
const updatePrimaryTargetSlab = asyncHandler(async (req, res) => {

  const {
    name,
    min_range,
    max_range,
    total_percentage,
    discount_percentage
  } = req.body;

  console.log(req.body);

  const slab = await PrimaryTargetSlab.findById(req.params.id);

  if (!slab) {
    return res.status(404).json({
      success: false,
      message: "Primary target slab not found",
    });
  }

  /* -------- UPDATE COMMON FIELD -------- */

  slab.name = name ?? slab.name;

  /* -------- PERCENTAGE SLAB -------- */

  if (slab.slab_type === "percentage") {

    slab.total_percentage = total_percentage ?? slab.total_percentage;
    slab.discount_percentage = discount_percentage ?? slab.discount_percentage;

  }

  /* -------- VALUE / VOLUME SLAB -------- */

  else {

    if (min_range < 0 || max_range <= min_range) {
      return res.status(400).json({
        success: false,
        message: "Invalid slab range",
      });
    }

    slab.min_range = min_range ?? slab.min_range;
    slab.max_range = max_range ?? slab.max_range;
    slab.discount_percentage = discount_percentage ?? slab.discount_percentage;

  }

  await slab.save();

  return res.status(200).json({
    success: true,
    message: "Primary target slab updated successfully",
    data: slab,
  });

});


/* ----------------------------------------
   DELETE PRIMARY TARGET SLAB (SOFT DELETE)
---------------------------------------- */
const deletePrimaryTargetSlab = asyncHandler(async (req, res) => {

  const slab = await PrimaryTargetSlab.findById(req.params.id);

  if (!slab) {
    return res.status(404).json({
      success: false,
      message: "Primary target slab not found",
    });
  }

  /* -------- SET INACTIVE INSTEAD OF DELETE -------- */

  slab.is_active = false;
  await slab.save();

  /* -------- OPTIONAL: REMOVE FROM TARGET -------- */
  await PrimaryTarget.updateMany(
    { targetSlabId: req.params.id },
    { $pull: { targetSlabId: req.params.id } }
  );

  return res.status(200).json({
    success: true,
    message: "Primary target slab deactivated successfully",
  });

});

module.exports = {
  updatePrimaryTargetSlab,
  deletePrimaryTargetSlab,
};