const asyncHandler = require("express-async-handler");
const SecondaryTargetSlab = require("../../models/secondaryTargetSlab.model");
const SecondaryTarget = require("../../models/secondaryTarget.model");

const getActiveSlabs = asyncHandler(async (req, res) => {
  try {
    const { slab_type } = req.query;
    const filter = {};

    // active filter

    if (req.query.is_active !== undefined && req.query.is_active !== "all") {
      filter.is_active = req.query.is_active === "true";
    } else if (req.query.is_active === undefined) {
      filter.is_active = true;
    }

    // slab type filter

    if (slab_type) {
      if (!["volume", "value", "percentage"].includes(slab_type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid slab type must be volume, value or percentage",
        });
      }
      filter.slab_type = slab_type;
    }

    // getting all the slabs

    const slabs = await SecondaryTargetSlab.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    // fetching the targets detail for each of the slab

    const formattedSlabs = await Promise.all(
      slabs.map(async (slab) => {
        const mappedTargets = await SecondaryTarget.find({
          targetSlabId: slab._id,
        })
          .populate({ path: "distributorId", select: "name dbCode" })
          .populate({ path: "retailerId", select: "outletName outletUID" })
          .select("name target_type distributorID retailerId")
          .lean();

        const formattedTargets = mappedTargets.map((t) => ({
          _id: t._id,
          name: t.name,
          target_type: t.target_type,
          distributorName: t.distributorId?.name || "N/A",
          distributorCode: t.distributorId?.dbCode || "N/A",
          retailerName: t.retailerId?.outletName || "N/A",
          retailerUID: t.retailerId?.outletUID || "N/A",
        }));

        // Build response shape — only include range fields or perc_slab based on type
        const slabResponse = {
          _id: slab._id,
          name: slab.name,
          slab_uid:slab.slabCode,
          slab_type: slab.slab_type,
          discount: slab.discount ?? null,
          is_active: slab.is_active,
          targets: formattedTargets,
          createdAt: slab.createdAt,
          updatedAt: slab.updatedAt,
        };

        if (slab.slab_type === "volume" || slab.slab_type === "value") {
          slabResponse.min_range = slab.min_range;
          slabResponse.max_range = slab.max_range;
        }

        if (slab.slab_type === "percentage") {
          slabResponse.perc_slab = slab.perc_slab;
        }

        return slabResponse;
      }),
    );

    return res.status(200).json({
      success: true,
      count: formattedSlabs.length,
      data: formattedSlabs,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({
      success: false,
      message: "failed to fetch the slabs",
    });
  }
});

module.exports = {getActiveSlabs}