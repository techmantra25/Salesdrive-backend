const SecondaryTargetSlab = require("../../../../models/secondaryTargetSlab.model");


const resolveSlabForTarget = async (target, totalAchievement) => {
  // if the target has no slabs mapped then nothing to resolve
  if (!target.targetSlabId || target.targetSlabId.length === 0) {
    return null;
  }

  // fetch only the active slabs mapped to this target
  const mappedSlabs = await SecondaryTargetSlab.find({
    _id: { $in: target.targetSlabId },
    is_active: true,
  }).lean();

  if (!mappedSlabs || mappedSlabs.length === 0) {
    return null;
  }

  const slabType = mappedSlabs[0].slab_type;

  // volume/value — find slab where achievement falls within min/max range
  if (slabType === "volume" || slabType === "value") {
    return (
      mappedSlabs.find(
        (s) =>
          totalAchievement >= s.min_range && totalAchievement <= s.max_range,
      ) || null
    );
  }

  // percentage — calculate achievement %, pick highest slab the achievement qualifies for
  // if below all slabs → no slab assigned
  if (slabType === "percentage") {
    const achievementPercentage =
      target.target > 0 ? (totalAchievement / target.target) * 100 : 0;

    const qualifiedSlabs = mappedSlabs
      .sort((a, b) => a.perc_slab - b.perc_slab)
      .filter((s) => achievementPercentage >= s.perc_slab);

    return qualifiedSlabs.length > 0
      ? qualifiedSlabs[qualifiedSlabs.length - 1]
      : null;
  }

  return null;
};

module.exports = { resolveSlabForTarget };