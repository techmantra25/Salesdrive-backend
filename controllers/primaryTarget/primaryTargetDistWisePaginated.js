const asyncHandler = require("express-async-handler");
const PrimaryTarget = require("../../models/primaryTarget.model");
const Slab = require("../../models/primaryTargetSlab.model");

const primaryTargetDistWisePaginated = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      approval_status,
      regionId,
      zoneId,
      stateId,
      target_type,
      fromDate,
      toDate,
      search,
      slabId,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    /* ================= DISTRIBUTOR ================= */

    const distributorId = req.user?._id || req.user?.distributorId;

    if (!distributorId) {
      return res.status(403).json({
        message: "Distributor not found",
      });
    }

    /* ================= FILTER ================= */

    let filter = {
      distributorId, // ✅ FORCE DISTRIBUTOR FILTER
    };

    const andConditions = [];

    if (approval_status) filter.approval_status = approval_status;
    if (regionId) filter.regionId = regionId;
    if (zoneId) filter.zoneId = zoneId;
    if (stateId) filter.stateId = stateId;
    if (target_type) filter.target_type = target_type;

    /* ---------------- SLAB FILTER ---------------- */

    if (slabId === "no-slab") {
      filter.targetSlabId = { $size: 0 };
    } else if (slabId) {
      filter.targetSlabId = { $in: [slabId] };
    }

    /* ---------------- DATE FILTER ---------------- */

    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      andConditions.push(
        { target_start_date: { $lte: end } },
        { target_end_date: { $gte: start } }
      );
    }

    /* ---------------- SEARCH ---------------- */

    if (search && search.trim()) {
      filter.$or = [{ name: new RegExp(search, "i") }];
    }

    if (andConditions.length) {
      filter.$and = andConditions;
    }

    /* ================= MAIN QUERY ================= */

    const [primaryTargets, filteredCount] = await Promise.all([
      PrimaryTarget.find(filter)
        .populate([
          { path: "regionId" },
          { path: "zoneId" },
          { path: "stateId" },
          { path: "created_by" },
          { path: "updated_by" },
          { path: "brandId", select: "name desc code status" },
          { path: "subBrandId", select: "name code brandId" },
          {
            path: "targetSlabId",
            select:
              "name slab_type min_range max_range total_percentage discount_percentage is_active",
          },
          {
            path: "distributorId",
            select: "name dbCode stateId regionId",
            populate: [
              {
                path: "stateId",
                model: "State",
                select: "name code",
              },
              {
                path: "regionId",
                model: "Region",
                select: "name code",
              },
            ],
          },
        ])
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit),

      PrimaryTarget.countDocuments(filter),
    ]);

    /* ================= SAME ENRICHMENT ================= */

    const allSlabs = await Slab.find({ is_active: true }).lean();

    const enrichedTargets = primaryTargets.map((t) => {
      const total =
        t.target_type === "volume"
          ? t.targetVolume
          : t.targetValue;

      const achievement = t.achivedTarget || 0;

      let achievedSlab = null;
      let slabs = [];

      if (t.targetSlabId && t.targetSlabId.length) {
        slabs = [...t.targetSlabId];
      }

      const mappedSlabs = allSlabs.filter((s) =>
        s.targetIds?.some(
          (id) => id.toString() === t._id.toString()
        )
      );

      const slabMap = new Map();

      [...slabs, ...mappedSlabs].forEach((s) => {
        slabMap.set(s._id.toString(), s);
      });

      slabs = Array.from(slabMap.values());

      const rangeSlabs = slabs
        .filter(
          (s) => s.slab_type === "volume" || s.slab_type === "value"
        )
        .sort((a, b) => a.min_range - b.min_range);

      for (const s of rangeSlabs) {
        if (
          achievement >= (s.min_range || 0) &&
          achievement <= (s.max_range || 0)
        ) {
          achievedSlab = s;
          break;
        }
      }

      const percentageSlabs = slabs
        .filter((s) => s.slab_type === "percentage")
        .sort((a, b) => a.total_percentage - b.total_percentage);

      if (percentageSlabs.length && total > 0) {
        const percent = (achievement / total) * 100;

        let matched = null;

        for (const s of percentageSlabs) {
          if (percent >= s.total_percentage) {
            matched = s;
          } else {
            break;
          }
        }

        if (matched) {
          achievedSlab = matched;
        }
      }

      /* ================= BRAND → SUBBRAND GROUP ================= */

      const brandMap = new Map();

      const brands = Array.isArray(t.brandId)
        ? t.brandId
        : t.brandId
        ? [t.brandId]
        : [];

      const subBrands = t.subBrandId || [];

      brands.forEach((brand) => {
        brandMap.set(brand._id.toString(), {
          brand,
          subBrands: [],
        });
      });

      subBrands.forEach((sb) => {
        const brandId =
          sb.brandId?._id?.toString() || sb.brandId?.toString();

        if (brandMap.has(brandId)) {
          brandMap.get(brandId).subBrands.push(sb);
        }
      });

      const groupedBrands = Array.from(brandMap.values());

      /* ================= RETURN ================= */

      return {
        ...t.toObject(),
        achievedSlab,
        groupedBrands, // ✅ ADDED ONLY THIS
      };
    });

    /* ================= COUNTS ================= */

    const [totalCount, totalApprovedCount] = await Promise.all([
      PrimaryTarget.countDocuments({ distributorId }),
      PrimaryTarget.countDocuments({
        distributorId,
        approval_status: "Approved",
      }),
    ]);

    /* ================= RESPONSE ================= */

    return res.status(200).json({
      status: 200,
      message: "Primary targets list fetched successfully",
      data: enrichedTargets,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(filteredCount / limit),
        totalCount,
        filteredCount,
        totalApprovedCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { primaryTargetDistWisePaginated };