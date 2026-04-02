const asyncHandler = require("express-async-handler");
const PrimaryTargetSlab = require("../../models/primaryTargetSlab.model");

const getActivePrimarySlabs = asyncHandler(async (req, res) => {
  try {
    const { slab_type, status } = req.query; // ✅ added status
    console.log("Received slab_type:", slab_type);

    const filter = {};

    if (slab_type) {

      const normalizedType = slab_type.trim().toLowerCase(); 

      if (!["volume", "value", "percentage"].includes(normalizedType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid slab type",
        });
      }

      filter.slab_type = normalizedType; 
    }

    // ✅ STATUS FILTER
    if (status === "active") {
      filter.is_active = true;
    } else if (status === "inactive") {
      filter.is_active = false;
    }

    const slabs = await PrimaryTargetSlab.find(filter)
      .populate({
        path: "targetIds",
        select: "_id name distributorId",
        populate: {
          path: "distributorId",
          select: "_id name dbCode",
        },
      })
      .sort({ createdAt: -1 });

    const formattedSlabs = slabs.map((slab) => ({
      _id: slab._id,
      name: slab.name,
      slabUid: slab.slabUid,
      slab_type: slab.slab_type,
      min_range: slab.min_range || null,
      max_range: slab.max_range || null,
      total_percentage: slab.total_percentage || null,
      discount_percentage: slab.discount_percentage || null,
      is_active: slab.is_active,
      createdAt: slab.createdAt,
      updatedAt: slab.updatedAt,

      targetIds: (slab.targetIds || []).map((t) => ({
        _id: t._id,
        name: t.name,
        distributorId: t.distributorId?._id || null,
        distributorName: t.distributorId?.name || null,
        distributorCode: t.distributorId?.dbCode || null,
      })),
    }));

    return res.status(200).json({
      success: true,
      count: formattedSlabs.length,
      data: formattedSlabs,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch active slabs",
    });
  }
});

module.exports = { getActivePrimarySlabs };