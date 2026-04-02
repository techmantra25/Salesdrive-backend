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

const bulkUploadSecondaryTargets = asyncHandler(async (req, res) => {
  const rows = req.body.targets;
  const distributorId = req.body.distributorId || req.params.distributorId;

  if (!distributorId) {
    return res.status(400).json({ message: "Distributor ID is required" });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "No data received" });
  }

  let inserted = 0;
  const failedRows = [];

  try {
    // ── Verify distributor once before the loop ────────────────────────────
    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(400).json({ message: "Invalid Distributor ID" });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const rowErrors = [];

        const name         = row["Target Name"];
        const target_type  = row["Target Type"]?.toLowerCase();
        const rawTarget    = Number(row["Target  Qty (PC)/Value (INR)"]);
        const startDate    = row["Start Date"];
        const endDate      = row["End Date"];
        const retailerUID  = row["Retailer UID"];
        const brandsStr    = row["Brands"];
        const subBrandsStr = row["Sub Brands"]; // optional column

        // ── Required field checks ────────────────────────────────────────
        if (!name)        addError(rowErrors, "Missing Target Name");
        if (!target_type) addError(rowErrors, "Missing Target Type");
        if (!startDate)   addError(rowErrors, "Missing Start Date");
        if (!endDate)     addError(rowErrors, "Missing End Date");
        if (!retailerUID) addError(rowErrors, "Missing Retailer UID");

        // ── 1. Target type validation ────────────────────────────────────
        if (target_type && !["volume", "value"].includes(target_type)) {
          addError(rowErrors, "Invalid Target Type, must be 'volume' or 'value'");
        }

        // ── 2. Target value validation ───────────────────────────────────
        if (isNaN(rawTarget) || rawTarget < 0) {
          addError(rowErrors, "Invalid Target Value");
        }

        // ── 3. Date parsing & validation ─────────────────────────────────
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

        // ── 4. Validate retailer ─────────────────────────────────────────
        let retailer = null;

        if (retailerUID) {
          retailer = await OutletApproved.findOne({ outletUID: retailerUID });
          if (!retailer) {
            addError(rowErrors, "Invalid Retailer UID");
          }
        }

        // ── 5. Brand validation (optional) ───────────────────────────────
        const brandNames     = parseCommaSeparated(brandsStr);
        let resolvedBrandIds = [];

        if (brandNames.length > 0) {
          const brands = await Brand.find({
            name: { $in: brandNames },
            status: true,
          });

          if (brands.length !== brandNames.length) {
            const foundNames    = brands.map((b) => b.name);
            const notFoundNames = brandNames.filter((bn) => !foundNames.includes(bn));
            addError(rowErrors, `Invalid brand name(s): ${notFoundNames.join(", ")}`);
          } else {
            resolvedBrandIds = brands.map((b) => b._id.toString());

            // Check all brands belong to distributor
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

        // ── 6. SubBrand validation (optional) ────────────────────────────
        const subBrandNames     = parseCommaSeparated(subBrandsStr);
        let resolvedSubBrandIds = [];

        if (subBrandNames.length > 0) {
          if (resolvedBrandIds.length === 0) {
            addError(rowErrors, "At least one valid brand is required when providing sub brands");
          } else {
            const subBrands = await SubBrand.find({
              name: { $in: subBrandNames },
              brandId: { $in: resolvedBrandIds },
            });

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

        // ── 7. Unique target name per retailer + distributor ──────────────
        if (retailer && name) {
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

        // ── 8. Overlap check (retailer + distributor + date range) ────────
        if (retailer && start && end) {
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

        // ── Bail out if any errors accumulated ────────────────────────────
        if (rowErrors.length > 0) {
          throw new Error(rowErrors.join(", "));
        }

        // ── 9. Create single target document ──────────────────────────────
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
    // Admin notification (role-based broadcast)
    const adminMessage = `Bulk upload: ${inserted} secondary target(s) created by distributor for ${new Set(rows.map(r => r["Retailer UID"])).size} retailer(s)`;
    
    await notificationQueue.add("bulkSecondaryTarget", {
      type: "Target",
      data: {
        message: adminMessage,
        title: "Bulk Secondary Targets Created",
        targetCount: inserted,
        distributorId,
      },
      userType: "User",
      room: "role:admin",
    });

    // Retailer notifications (user-specific) - group by retailer
    const retailerTargets = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const retailerUID = row["Retailer UID"];
      const targetName = row["Target Name"];
      const targetType = row["Target Type"]?.toLowerCase();
      const targetValue = Number(row["Target Qty (PC)/Value (INR)"]);
      
      if (retailerUID && !failedRows.find(fr => fr["Row Number"] === i + 2)) {
        if (!retailerTargets.has(retailerUID)) {
          retailerTargets.set(retailerUID, []);
        }
        retailerTargets.get(retailerUID).push({
          name: targetName,
          type: targetType,
          value: targetValue,
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

module.exports = { bulkUploadSecondaryTargets };