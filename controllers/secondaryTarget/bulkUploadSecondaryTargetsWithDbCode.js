const asyncHandler = require("express-async-handler");
const { Parser } = require("json2csv");

const Distributor = require("../../models/distributor.model");
const SecondaryTarget = require("../../models/secondaryTarget.model");
const OutletApproved = require("../../models/outletApproved.model");
const Brand = require("../../models/brand.model");
const SubBrand = require("../../models/subBrand.model");
const notificationQueue = require("../../queues/notificationQueue");
const {
  calculateHistoricalAchievement,
} = require("../../controllers/bill/util/updateSecondaryTargetAchievement");

const {generateTargetCode} = require("./utils/secondaryTargetCodeGenerator");

// ── Helpers ──────────────────────────────────────────────────────────────────

const parseDDMMYYYY = (dateStr) => {
  if (!dateStr) return null;
  const [dd, mm, yyyy] = dateStr.split("-");
  const date = new Date(yyyy, mm - 1, dd);
  date.setHours(0, 0, 0, 0);
  if (isNaN(date.getTime())) return null;
  return date;
};

const parseCommaSeparated = (str) => {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const addError = (errors, msg) => errors.push(msg);

// ─────────────────────────────────────────────────────────────────────────────

const bulkUploadSecondaryTargetsWithDbCode = asyncHandler(async (req, res) => {
  const rows = req.body.targets;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "No data received" });
  }

  let inserted = 0;
  const failedRows = [];

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const rowErrors = [];

        const distributorDbCode = row["Distributor DB Code"];
        const name             = row["Target Name"];
        const target_type      = row["Target Type"]?.toLowerCase();
        const rawTarget        = Number(row["Target  Qty (PC)/Value (INR)"]);
        const startDate        = row["Start Date"];
        const endDate          = row["End Date"];
        const retailerUID      = row["Retailer UID"];
        const brandsStr        = row["Brands"];
        const subBrandsStr     = row["Sub Brands"]; // optional column

        // ── Required field checks ──────────────────────────────────────────
        if (!distributorDbCode) addError(rowErrors, "Missing Distributor DB Code");
        if (!name)              addError(rowErrors, "Missing Target Name");
        if (!target_type)       addError(rowErrors, "Missing Target Type");
        if (!startDate)         addError(rowErrors, "Missing Start Date");
        if (!endDate)           addError(rowErrors, "Missing End Date");
        if (!retailerUID)       addError(rowErrors, "Missing Retailer UID");

        // ── 1. Validate distributor ────────────────────────────────────────
        let distributor   = null;
        let distributorId = null;

        if (distributorDbCode) {
          distributor = await Distributor.findOne({ dbCode: distributorDbCode });

          if (!distributor) {
            addError(rowErrors, "Invalid Distributor DB Code");
          } else {
            distributorId = distributor._id;
          }
        }

        // ── 2. Target type validation ──────────────────────────────────────
        if (target_type && !["volume", "value"].includes(target_type)) {
          addError(rowErrors, "Invalid Target Type, must be 'volume' or 'value'");
        }

        // ── 3. Target value validation ─────────────────────────────────────
        if (isNaN(rawTarget) || rawTarget < 0) {
          addError(rowErrors, "Invalid Target Value");
        }

        // ── 4. Date parsing & validation ───────────────────────────────────
        const start = parseDDMMYYYY(startDate);
        const end   = parseDDMMYYYY(endDate);

        if (!start) addError(rowErrors, "Invalid Start Date");
        if (!end)   addError(rowErrors, "Invalid End Date");

        if (start) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const startOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
          startOfCurrentMonth.setHours(0, 0, 0, 0);

          if (start < startOfCurrentMonth) {
            addError(rowErrors, "Start Date cannot be before the start of the current month");
          }
        }

        if (start && end && end < start) {
          addError(rowErrors, "End Date cannot be before Start Date");
        }

        // ── 5. Validate retailer ───────────────────────────────────────────
        let retailer = null;

        if (retailerUID) {
          retailer = await OutletApproved.findOne({ outletUID: retailerUID });
          if (!retailer) {
            addError(rowErrors, "Invalid Retailer UID");
          }
        }

        // ── 6. Brand validation (optional) ────────────────────────────────
        const brandNames = parseCommaSeparated(brandsStr);
        let resolvedBrandIds = [];

        if (brandNames.length > 0) {
          const brands = await Brand.find({
            name: { $in: brandNames },
            status: true,
          });

          // Check all brand names were found
          if (brands.length !== brandNames.length) {
            const foundNames   = brands.map((b) => b.name);
            const notFoundNames = brandNames.filter((bn) => !foundNames.includes(bn));
            addError(rowErrors, `Invalid brand name(s): ${notFoundNames.join(", ")}`);
          } else {
            resolvedBrandIds = brands.map((b) => b._id.toString());

            // Check brands belong to distributor
            if (distributor) {
              const distributorBrandIds = distributor.brandId.map((id) => id.toString());
              const invalidBrandIds     = resolvedBrandIds.filter(
                (bid) => !distributorBrandIds.includes(bid)
              );

              if (invalidBrandIds.length > 0) {
                const invalidBrandDocs  = await Brand.find({ _id: { $in: invalidBrandIds } });
                const invalidBrandNames = invalidBrandDocs.map((b) => b.name);
                addError(rowErrors, `Brand(s) not mapped to distributor: ${invalidBrandNames.join(", ")}`);
                resolvedBrandIds = []; // clear so subBrand check doesn't proceed on bad brands
              }
            }
          }
        }

        // ── 7. SubBrand validation (optional) ─────────────────────────────
        const subBrandNames      = parseCommaSeparated(subBrandsStr);
        let resolvedSubBrandIds  = [];

        if (subBrandNames.length > 0) {
          if (resolvedBrandIds.length === 0) {
            addError(rowErrors, "At least one valid brand is required when providing sub brands");
          } else {
            const subBrands = await SubBrand.find({
              name: { $in: subBrandNames },
              brandId: { $in: resolvedBrandIds },
            });

            // Every provided subBrand name must be found AND belong to one of the brands
            if (subBrands.length !== subBrandNames.length) {
              const foundSubNames    = subBrands.map((sb) => sb.name);
              const notFoundSubNames = subBrandNames.filter(
                (sbn) => !foundSubNames.includes(sbn)
              );
              addError(
                rowErrors,
                `Sub brand name(s) not found or do not belong to the provided brands: ${notFoundSubNames.join(", ")}`
              );
            } else {
              resolvedSubBrandIds = subBrands.map((sb) => sb._id.toString());
            }
          }
        }

        // ── 8. Unique target name per retailer + distributor ───────────────
        if (distributorId && retailer && name) {
          const existingTargetName = await SecondaryTarget.findOne({
            distributorId,
            retailerId: retailer._id,
            is_active: true,
            name: { $regex: new RegExp(`^${name}$`, "i") },
          });

          if (existingTargetName) {
            addError(rowErrors, `Target name "${name}" already exists for this retailer and distributor`);
          }
        }

        // ── 9. Overlap check (retailer + distributor + date range) ─────────
        if (distributorId && retailer && start && end) {
          const overlappingTarget = await SecondaryTarget.findOne({
            distributorId,
            retailerId: retailer._id,
            is_active: true,
            start_date: { $lte: end },
            end_date:   { $gte: start },
          });

          if (overlappingTarget) {
            addError(
              rowErrors,
              "An active secondary target already exists for this retailer and distributor in the selected date range"
            );
          }
        }

        // ── Bail out if any errors accumulated ─────────────────────────────
        if (rowErrors.length > 0) {
          throw new Error(rowErrors.join(", "));
        }

        // ── 10. Create single target document ──────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const targetCode = await generateTargetCode();

        const secondaryTarget = await SecondaryTarget.create({
          distributorId,
          retailerId:  retailer._id,
          brandId:     resolvedBrandIds,
          subBrandId:  resolvedSubBrandIds,
          name,
          targetCode,
          target_type,
          target:      rawTarget,
          start_date:  start,
          end_date:    end,
          stateId:     retailer.stateId,
          regionId:    retailer.regionId,
        });

        if (start < today) {
          const completeTarget = await SecondaryTarget.findById(secondaryTarget._id).lean();
          if (completeTarget) {
            await calculateHistoricalAchievement(completeTarget);
          }
        }

        inserted++;

      } catch (rowError) {
        failedRows.push({
          ...row,
          "Error Reason": rowError.message,
          "Row Number":   i + 2,
        });
      }
    }

    let failedCSV = null;
    if (failedRows.length > 0) {
      const parser = new Parser();
      const csv    = parser.parse(failedRows);
      failedCSV    = Buffer.from(csv).toString("base64");
    }

    // 🔔 Send notifications
    // Group targets by distributor and retailer for notifications
    const distributorTargets = new Map();
    const retailerTargets = new Map();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const distributorDbCode = row["Distributor DB Code"];
      const retailerUID = row["Retailer UID"];
      const targetName = row["Target Name"];
      const targetType = row["Target Type"]?.toLowerCase();
      const targetValue = Number(row["Target Qty (PC)/Value (INR)"]);
      
      // Skip failed rows
      if (failedRows.find(fr => fr["Row Number"] === i + 2)) {
        continue;
      }

      // Group by distributor
      if (distributorDbCode) {
        if (!distributorTargets.has(distributorDbCode)) {
          distributorTargets.set(distributorDbCode, { count: 0, retailers: new Set() });
        }
        distributorTargets.get(distributorDbCode).count++;
        distributorTargets.get(distributorDbCode).retailers.add(retailerUID);
      }

      // Group by retailer
      if (retailerUID) {
        if (!retailerTargets.has(retailerUID)) {
          retailerTargets.set(retailerUID, []);
        }
        retailerTargets.get(retailerUID).push({
          name: targetName,
          type: targetType,
          value: targetValue,
          distributorDbCode,
        });
      }
    }

    // Send notification to each distributor
    for (const [distributorDbCode, data] of distributorTargets.entries()) {
      const distributor = await Distributor.findOne({ dbCode: distributorDbCode });
      if (distributor) {
        const distributorMessage = `${data.count} secondary target(s) created for ${data.retailers.size} retailer(s) via bulk upload`;
        
        await notificationQueue.add("bulkSecondaryTargetDistributor", {
          type: "Target",
          data: {
            message: distributorMessage,
            title: "Bulk Targets Created",
            targetCount: data.count,
            retailerCount: data.retailers.size,
          },
          userId: distributor._id,
          userType: "Distributor",
        });
      }
    }

    // Send notification to each retailer
    for (const [retailerUID, targets] of retailerTargets.entries()) {
      const retailer = await OutletApproved.findOne({ outletUID: retailerUID });
      if (retailer) {
        const targetCount = targets.length;
        const targetNames = targets.slice(0, 3).map(t => `"${t.name}"`).join(", ");
        const moreCount = targetCount > 3 ? ` and ${targetCount - 3} more` : "";
        
        const retailerMessage = `${targetCount} new target(s) ${targetNames}${moreCount} have been assigned to you via bulk upload`;
        
        await notificationQueue.add("bulkSecondaryTargetRetailer", {
          type: "Target",
          data: {
            message: retailerMessage,
            title: "New Targets Assigned",
            targetCount,
            targets: targets.slice(0, 3),
          },
          userId: retailer._id,
          userType: "OutletApproved",
        });
      }
    }

    return res.status(200).json({
      message:  "Bulk upload completed",
      inserted,
      failed:   failedRows.length,
      failedCSV,
    });

  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = { bulkUploadSecondaryTargetsWithDbCode };