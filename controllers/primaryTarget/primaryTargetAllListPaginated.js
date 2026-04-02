const asyncHandler = require("express-async-handler");
const { format } = require("fast-csv");
const PrimaryTarget = require("../../models/primaryTarget.model");
const Distributor = require("../../models/distributor.model");
const Slab = require("../../models/primaryTargetSlab.model");

const primaryTargetAllListPaginated = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      approval_status,
      regionId,
      zoneId,
      stateId,
      distributorId,
      target_type,
      fromDate,
      toDate,
      brandId,
      search,
      slabId,
      createdFrom,
      createdTo,
      download,
      isActive
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    let filter = {};

    if (approval_status) filter.approval_status = approval_status;
    if (regionId) filter.regionId = regionId;
    if (zoneId) filter.zoneId = zoneId;
    if (distributorId) filter.distributorId = distributorId;
    if (target_type) filter.target_type = target_type;

    if (stateId) {
      const distributorIds = await Distributor.distinct("_id", {
        stateId: { $in: [stateId] },
      });

      if (!distributorId) {
        filter.distributorId = { $in: distributorIds };
      }
    }

    if (slabId === "no-slab") {
      filter.targetSlabId = { $size: 0 };
    } else if (slabId) {
      filter.targetSlabId = { $in: [slabId] };
    }

    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      filter.target_start_date = { $gte: start };
      filter.target_end_date = { $lte: end };
    }

    if (createdFrom && createdTo) {
      const cStart = new Date(createdFrom);
      const cEnd = new Date(createdTo);

      cStart.setHours(0, 0, 0, 0);
      cEnd.setHours(23, 59, 59, 999);

      filter.createdAt = { $gte: cStart, $lte: cEnd };
    }

    if (search && search.trim()) {
      const regex = new RegExp(search, "i");

      filter.$or = [
        { name: regex },       
        { targetUid: regex },   
      ];
    }

    if (brandId) {
      filter.brandId = brandId;
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }
    /* ================= CSV ================= */

    if (download === "csv") {
      const data = await PrimaryTarget.find(filter).populate([
        { path: "brandId", select: "name desc code status" },
        {
          path: "subBrandId",
          select: "name code brandId", // ✅ FIX
        },
        {
          path: "distributorId",
          select: "name dbCode stateId regionId city phone",
          populate: [
            { path: "stateId", model: "State", select: "name code" },
            { path: "regionId", model: "Region", select: "name code" },
          ],
        },
        { path: "stateId", select: "name code" },
        { path: "regionId", select: "name code" },
        {
          path: "targetSlabId",
          select:
            "min_range max_range name slab_type discount_percentage",
        },
      ]);

      const slabs = await Slab.find({ is_active: true }).lean();

      const formatValue = (val, type) => {
        if (!val) return "";
        if (type === "volume") return `${val} PC`;
        if (type === "value") return `${val} INR`;
        return val;
      };

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=primary-targets.csv"
      );
      res.setHeader("Content-Type", "text/csv");

      const csvStream = format({ headers: true });
      csvStream.pipe(res);

      data.forEach((t) => {
        const total =
          t.target_type === "volume"
            ? t.targetVolume
            : t.targetValue;

        const achievementPercent =
          total > 0
            ? ((t.achivedTarget || 0) / total) * 100
            : 0;

        /* ===== GROUP BRAND ===== */

        const brandMap = new Map();

        const brands = Array.isArray(t.brandId)
          ? t.brandId
          : t.brandId
            ? [t.brandId]
            : [];

        const subBrands = t.subBrandId || [];

        brands.forEach((b) => {
          brandMap.set(b._id.toString(), {
            brand: b.name,
            subs: [],
          });
        });

        subBrands.forEach((sb) => {
          const bid =
            sb.brandId?._id?.toString() || sb.brandId?.toString();

          if (brandMap.has(bid)) {
            brandMap.get(bid).subs.push(sb.name);
          }
        });

        const grouped = Array.from(brandMap.values());

        const row = {
          Distributor: t.distributorId?.name || "",
          "Distributor Code": t.distributorId?.dbCode || "",
          Brand: grouped.map((g) => g.brand).join("\n"),
          "Sub Brand": grouped
            .map((g) => g.subs.join(", "))
            .join("\n"),
          "Target Name": t.name,
          "Target Type": t.target_type,
          "Target Qty/Value": formatValue(total, t.target_type),
          "Target Tenure From": t.target_start_date
            ?.toISOString()
            .split("T")[0],
          "Target Tenure To": t.target_end_date
            ?.toISOString()
            .split("T")[0],
          State:
            t.stateId?.name ||
            t.distributorId?.stateId?.name ||
            "",
          Region:
            t.regionId?.name ||
            t.distributorId?.regionId?.name ||
            "",
        };

        slabs.forEach((slab) => {
          const header = `${slab.name} (${slab.min_range}-${slab.max_range})`;

          const hasSlab =
            (t.targetSlabId &&
              t.targetSlabId.some(
                (s) => s._id.toString() === slab._id.toString()
              )) ||
            slab.targetIds?.some(
              (id) => id.toString() === t._id.toString()
            );

          row[header] = hasSlab
            ? formatValue(total, t.target_type)
            : "";
        });

        row["NO SLAB"] =
          (t.targetSlabId && t.targetSlabId.length > 0) ||
            slabs.some((s) =>
              s.targetIds?.some(
                (id) => id.toString() === t._id.toString()
              )
            )
            ? ""
            : formatValue(total, t.target_type);

        row["Achievement %"] = achievementPercent.toFixed(0);

        csvStream.write(row);
      });

      csvStream.end();
      return;
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
          {
            path: "subBrandId",
            select: "name code brandId", // ✅ FIX
          },
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

      /* ===== GROUP BRAND ===== */

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
        const bid =
          sb.brandId?._id?.toString() || sb.brandId?.toString();

        if (brandMap.has(bid)) {
          brandMap.get(bid).subBrands.push(sb);
        }
      });

      const groupedBrands = Array.from(brandMap.values());

      return {
        ...t.toObject(),
        achievedSlab,
        groupedBrands, // ✅ ONLY ADDED
      };
    });

    const [totalCount, totalApprovedCount] = await Promise.all([
      PrimaryTarget.estimatedDocumentCount(),
      PrimaryTarget.countDocuments({ approval_status: "Approved" }),
    ]);

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

module.exports = { primaryTargetAllListPaginated };