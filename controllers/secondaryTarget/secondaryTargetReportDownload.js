const asyncHandler = require("express-async-handler");
const SecondaryTarget = require("../../models/secondaryTarget.model");
const moment = require("moment");

const secondaryTargetReportDownload = asyncHandler(async (req, res) => {
  try {
    let {
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
      tenureDateFrom,
      tenureDateTo,
    } = req.query;

    /* -------------------- FILTERS -------------------- */
    let filter = {};

    if (regionId)      filter.regionId      = regionId;
    if (zoneId)        filter.zoneId        = zoneId;
    if (stateId)       filter.stateId       = stateId;
    if (name)          filter.name          = { $regex: name, $options: "i" };
    if (distributorId) filter.distributorId = distributorId;
    if (retailerId)    filter.retailerId    = retailerId;
    if (target_type)   filter.target_type   = target_type;

    filter.is_active = true;

    if (slabId) {
      filter.targetSlabId = slabId;
    }

    if (brandIds) {
      const brandArray = brandIds.split(",").map((id) => id.trim());
      filter.brandId = { $in: brandArray };
    }

    if (subBrandIds) {
      const subBrandArray = subBrandIds.split(",").map((id) => id.trim());
      filter.subBrandId = { $in: subBrandArray };
    }

    if (tenureDateFrom || tenureDateTo) {
      filter.$and = [];
      if (tenureDateFrom) {
        filter.$and.push({ end_date: { $gte: new Date(tenureDateFrom) } });
      }
      if (tenureDateTo) {
        filter.$and.push({ start_date: { $lte: new Date(tenureDateTo) } });
      }
    }

    /* -------------------- QUERY -------------------- */
    const data = await SecondaryTarget.find(filter)
      .populate({
        path: "retailerId",
        select: "outletName outletUID outletCode mobile1 stateId regionId zoneId",
        populate: [
          { path: "zoneId",   select: "name code" },
          { path: "stateId",  select: "name code" },
          { path: "regionId", select: "name code" },
        ],
      })
      .populate({ path: "distributorId",      select: "name dbCode" })
      .populate({ path: "brandId",            select: "name code" })
      .populate({ path: "subBrandId",         select: "name code" })
      .populate({ path: "regionId",           select: "name code" })
      .populate({ path: "zoneId",             select: "name code" })
      .populate({ path: "stateId",            select: "name code" })
      .populate({
        path: "targetSlabId",
        select: "name slab_type min_range max_range perc_slab discount is_active",
      })
      .populate({
        path: "currentTargetSlabId",
        select: "name slab_type min_range max_range perc_slab discount is_active",
      })
      .sort({ createdAt: -1 })
      .lean();

    /* -------------------- CSV HEADERS -------------------- */
    const headers = [
      "Target Code",
      "Retailer UID",
      "Retailer Code (SFA)",
      "Retailer Name",
      "Distributor Name",
      "Brands",
      "Target Name",
      "Sub Brands",
      "Target Type",
      "Target Qty/Value",
      "Unit",
      "Target From",
      "Target To",
      "State",
      "Region",
      "Current Slab Name",
      "Slab Range / %",
      "Target Achieved",
      "Sales Return",
      "Achievement %",
      "Scheme (Discount %)",
    ];

    /* -------------------- CSV ROWS -------------------- */
    const csvRows = data.map((target) => {
      // Brands — comma separated
      const brandsStr =
        Array.isArray(target.brandId) && target.brandId.length > 0
          ? target.brandId.map((b) => b.name || b.code || "").join(", ")
          : "N/A";

      // SubBrands — comma separated
      const subBrandsStr =
        Array.isArray(target.subBrandId) && target.subBrandId.length > 0
          ? target.subBrandId.map((sb) => sb.name || sb.code || "").join(", ")
          : "N/A";

      // Target qty/value — split into value and unit separately
      const targetDisplay = target.target || 0;
      const targetUnit    = target.target_type === "volume" ? "Pcs" : "INR";

      // Current slab name
      const currentSlab  = target.currentTargetSlabId;
      const slabName     = currentSlab ? currentSlab.name : "No Slab";

      // Slab range or percentage
      let slabRangeOrPerc = "—";
      if (currentSlab) {
        if (currentSlab.slab_type === "percentage") {
          slabRangeOrPerc = `${currentSlab.perc_slab}%`;
        } else {
          slabRangeOrPerc = `${currentSlab.min_range} - ${currentSlab.max_range}`;
        }
      }

      // Achievement
      const achieved = target.achivedTarget || 0;

      // Sales return
      const returned = target.returnedQty || 0;

      // Achievement percentage
      const achievementPercentage =
        target.target > 0
          ? ((achieved / target.target) * 100).toFixed(2)
          : "0.00";

      // Discount from current slab
      const discount =
        currentSlab?.discount != null ? `${currentSlab.discount}%` : "N/A";

      return [
        target.targetCode         || "N/A",
        target.retailerId?.outletUID      || "N/A",
        target.retailerId?.outletCode     || "N/A",
        target.retailerId?.outletName     || "N/A",
        target.distributorId?.name        || "N/A",
        brandsStr,
        target.name                       || "N/A",
        subBrandsStr,
        target.target_type?.toUpperCase() || "N/A",
        targetDisplay,
        targetUnit,
        moment(target.start_date).format("DD-MM-YYYY"),
        moment(target.end_date).format("DD-MM-YYYY"),
        target.retailerId?.stateId?.name  || "N/A",
        target.retailerId?.regionId?.name || "N/A",
        slabName,
        slabRangeOrPerc,
        achieved,
        returned,
        `${achievementPercentage}%`,
        discount,
      ];
    });

    /* -------------------- BUILD CSV -------------------- */
    const csvContent = [
      headers.join(","),
      ...csvRows.map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    /* -------------------- SEND -------------------- */
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=secondary-target-report-${moment().format("DD-MM-YYYY")}.csv`,
    );

    res.status(200).send(csvContent);
  } catch (error) {
    res.status(500);
    throw new Error(error?.message || "Failed to generate secondary target report");
  }
});

module.exports = { secondaryTargetReportDownload };