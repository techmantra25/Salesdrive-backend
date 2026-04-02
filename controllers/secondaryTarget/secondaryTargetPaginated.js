const asyncHandler = require("express-async-handler");
const SecondaryTarget = require("../../models/secondaryTarget.model");
const moment = require("moment");

const secondaryTargetPaginated = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      distributorId,
      retailerId,
      target_type,
      start_date,
      end_date,
      name,
      zoneId,
      regionId,
      stateId,
      slabId,
      brandIds,
      subBrandIds,
      is_active,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const skip = (page - 1) * limit;

    /* -------------------- FILTERS -------------------- */
    let filter = {};

    if (regionId) filter.regionId = regionId;
    if (zoneId) filter.zoneId = zoneId;
    if (stateId) filter.stateId = stateId;
    if (distributorId) filter.distributorId = distributorId;
    if (retailerId) filter.retailerId = retailerId;
    if (target_type) filter.target_type = target_type;

    if (is_active !== undefined && is_active !== "") {
      filter.is_active = is_active === "true";
    }

    if (name) {
      filter.$or = [
        { name: { $regex: name, $options: "i" } },
        { targetCode: { $regex: name, $options: "i" } },
      ];
    }

    // Filter by slab — check against the mapped slabs array
    if (slabId) {
      filter.targetSlabId = slabId;
    }

    // brandIds filter — comma separated list of brand IDs
    if (brandIds) {
      const brandArray = brandIds.split(",").map((id) => id.trim());
      filter.brandId = { $in: brandArray };
    }

    // subBrandIds filter — comma separated list of subBrand IDs
    if (subBrandIds) {
      const subBrandArray = subBrandIds.split(",").map((id) => id.trim());
      filter.subBrandId = { $in: subBrandArray };
    }

    // Date range filter — targets that overlap with the given date range
    if (start_date || end_date) {
      filter.$and = [];
      if (start_date) {
        filter.$and.push({ end_date: { $gte: new Date(start_date) } });
      }
      if (end_date) {
        filter.$and.push({ start_date: { $lte: new Date(end_date) } });
      }
    }

    /* -------------------- QUERY -------------------- */
    const [data, totalCount] = await Promise.all([
      SecondaryTarget.find(filter)
        .populate({
          path: "retailerId",
          select:
            "outletName outletUID outletCode mobile1 stateId regionId zoneId",
          populate: [
            { path: "zoneId", select: "name code" },
            { path: "stateId", select: "name code" },
            { path: "regionId", select: "name code" },
          ],
        })
        .populate({ path: "distributorId", select: "name dbCode brandId" })
        .populate({ path: "brandId", select: "name code" })
        .populate({ path: "subBrandId", select: "name code brandId" })
        .populate({ path: "regionId", select: "name code" })
        .populate({ path: "zoneId", select: "name code" })
        .populate({ path: "stateId", select: "name code" })
        // targetSlabId — full array of mapped slabs
        .populate({
          path: "targetSlabId",
          select:
            "name slab_type min_range max_range perc_slab discount is_active",
        })
        // currentTargetSlabId — the slab currently assigned based on achievement
        .populate({
          path: "currentTargetSlabId",
          select:
            "name slab_type min_range max_range perc_slab discount is_active",
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      SecondaryTarget.countDocuments(filter),
    ]);

    /* -------------------- FORMAT -------------------- */
    const formattedData = data.map((target) => {
      const currentSlab = target.currentTargetSlabId;

      return {
        _id: target._id,
        name: target.name,
        target_code: target.targetCode,
        target_type: target.target_type,
        target: target.target,
        achivedTarget: target.achivedTarget || 0,
        is_active:target.is_active,

        // brands — full array
        brands: (target.brandId || []).map((b) => ({
          _id: b._id,
          name: b.name,
          code: b.code,
        })),

        // subBrands — full array
        subBrands: (target.subBrandId || []).map((sb) => ({
          _id: sb._id,
          name: sb.name,
          code: sb.code,
          brandId: sb.brandId,
        })),

        target_from: moment(target.start_date).format("DD-MM-YYYY"),
        target_to: moment(target.end_date).format("DD-MM-YYYY"),
        start_date: target.start_date,
        end_date: target.end_date,

        // retailer info
        retailer_uid: target.retailerId?.outletUID || "N/A",
        retailer_name: target.retailerId?.outletName || "N/A",
        zone: target.retailerId?.zoneId?.name || "N/A",
        state: target.retailerId?.stateId?.name || "N/A",
        region: target.retailerId?.regionId?.name || "N/A",

        // current active slab — the one that matches the current achievement
        currentSlab: currentSlab
          ? {
              _id: currentSlab._id,
              name: currentSlab.name,
              slab_type: currentSlab.slab_type,
              // only send relevant fields based on slab type
              ...(currentSlab.slab_type === "volume" ||
              currentSlab.slab_type === "value"
                ? {
                    min_range: currentSlab.min_range,
                    max_range: currentSlab.max_range,
                  }
                : {}),
              ...(currentSlab.slab_type === "percentage"
                ? { perc_slab: currentSlab.perc_slab }
                : {}),
              discount: currentSlab.discount ?? null,
              is_active: currentSlab.is_active,
            }
          : null,

        // all slabs mapped to this target
        mappedSlabs: (target.targetSlabId || []).map((slab) => ({
          _id: slab._id,
          name: slab.name,
          slab_type: slab.slab_type,
          ...(slab.slab_type === "volume" || slab.slab_type === "value"
            ? { min_range: slab.min_range, max_range: slab.max_range }
            : {}),
          ...(slab.slab_type === "percentage"
            ? { perc_slab: slab.perc_slab }
            : {}),
          discount: slab.discount ?? null,
          is_active: slab.is_active,
        })),

        // raw populated objects for any further frontend use
        retailerId: target.retailerId,
        distributorId: target.distributorId,
        regionId: target.retailerId?.regionId,
        zoneId: target.retailerId?.zoneId,
        stateId: target.retailerId?.stateId,
        createdAt: target.createdAt,
        updatedAt: target.updatedAt,
      };
    });

    res.status(200).json({
      success: true,
      data: formattedData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        filteredCount: data.length,
      },
    });
  } catch (error) {
    res.status(500);
    throw new Error(error?.message || "Failed to fetch secondary targets");
  }
});

module.exports = { secondaryTargetPaginated };
