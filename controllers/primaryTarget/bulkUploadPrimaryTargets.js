const asyncHandler = require("express-async-handler");
const { Parser } = require("json2csv");
const Distributor = require("../../models/distributor.model");
const PrimaryTarget = require("../../models/primaryTarget.model");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Zone = require("../../models/zone.model");
const Invoice = require("../../models/invoice.model");
const Brand = require("../../models/brand.model");
const SubBrand = require("../../models/subBrand.model");

// ================= TARGET UID LOGIC (ADDED) =================
const getCodeFromDbCode = (dbCode) => {
  if (!dbCode || dbCode.length < 3) return "XX0";

  const firstTwo = dbCode.slice(0, 2).toUpperCase();
  const lastChar = dbCode.slice(-1).toUpperCase();

  return `${firstTwo}${lastChar}`;
};

const generateTargetUid = async (dbCode) => {
  const codePart = getCodeFromDbCode(dbCode);
  const prefix = `PTR-${codePart}`;

  const lastTarget = await PrimaryTarget.findOne({
    targetUid: { $regex: /^PTR-[A-Z0-9]{3}\d{4}$/ },
  })
    .sort({ targetUid: -1 })
    .select("targetUid");

  let nextNumber = 1;

  if (lastTarget?.targetUid) {
    const match = lastTarget.targetUid.match(/(\d{4})$/);

    if (match) {
      const lastNumber = Number(match[1]);

      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `${prefix}${String(nextNumber).padStart(4, "0")}`;
};
// ==========================================================

const parseDDMMYYYY = (dateStr) => {
  if (!dateStr) return null;
  const [dd, mm, yyyy] = dateStr.split("-");
  return new Date(`${yyyy}-${mm}-${dd}`);
};

const findByCodeOrSlug = async (Model, value) => {
  return Model.findOne({
    $or: [
      { code: value },
      { slug: value?.toUpperCase() },
      { name: new RegExp(`^${value}$`, "i") },
    ],
  });
};

const addError = (errors, msg) => {
  errors.push(msg);
};

const bulkUploadPrimaryTargets = asyncHandler(async (req, res) => {

  const rows = req.body.targets;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "No data received" });
  }

  let inserted = 0;
  let updated = 0;
  const failedRows = [];

  try {

    for (let i = 0; i < rows.length; i++) {

      const row = rows[i];
      const originalRow = { ...row };
      try {

        const rowErrors = [];

        const name = row["Target Name"];
        const distributorCode = row["Distributor Code"];
        const target_type = row["Target Type"]?.toLowerCase();
        const rawTarget = Number(row["Target Qty (PC)/Value (INR)"]);
        const startDate = row["Target  Tenure  (from)"];
        const endDate = row["Target  Tenure  (to)"];
        const stateCode = row["State"];
        const regionCode = row["Region"];
        const zoneCode = row["Zone"];
        const brandColumn = row["Brand"];
        const subBrandColumn = row["Sub Brand"];

        if (!name) addError(rowErrors, "Missing Target Name");
        if (!distributorCode) addError(rowErrors, "Missing Distributor Code");
        if (!target_type) addError(rowErrors, "Missing Target Type");
        if (!startDate) addError(rowErrors, "Missing Start Date");
        if (!endDate) addError(rowErrors, "Missing End Date");

        if (target_type && !["volume", "value"].includes(target_type)) {
          addError(rowErrors, "Invalid Target Type");
        }

        if (isNaN(rawTarget) || rawTarget <= 0) {
          addError(rowErrors, "Invalid Target Value");
        }

        let targetValue = null;
        let targetVolume = null;

        if (target_type === "value") targetValue = rawTarget;
        if (target_type === "volume") targetVolume = rawTarget;

        const start = parseDDMMYYYY(startDate);
        const end = parseDDMMYYYY(endDate);

        if (!start || isNaN(start)) addError(rowErrors, "Invalid Start Date");
        if (!end || isNaN(end)) addError(rowErrors, "Invalid End Date");

        if (start && end && start >= end) {
          addError(
            rowErrors,
            "Target End Date must be greater than Target Start Date"
          );
        }

        const distributor = await Distributor.findOne({
          dbCode: distributorCode,
        });

        if (!distributor) addError(rowErrors, "Invalid Distributor Code");

        let stateId = null;
        if (stateCode) {
          const state = await findByCodeOrSlug(State, stateCode);
          if (!state) addError(rowErrors, "Invalid State Code");
          else stateId = state._id;
        }

        let regionId = null;
        if (regionCode) {
          const region = await findByCodeOrSlug(Region, regionCode);
          if (!region) addError(rowErrors, "Invalid Region Code");
          else regionId = region._id;
        }

        let zoneId = null;
        if (zoneCode) {
          const zone = await findByCodeOrSlug(Zone, zoneCode);
          if (!zone) addError(rowErrors, "Invalid Zone Code");
          else zoneId = zone._id;
        }

        if (rowErrors.length > 0) {
          failedRows.push({
            ...originalRow,
            "Error Reason": rowErrors.join(", "),
            "Row Number": i + 2,
          });
          continue;
        }

        // 🔥 GENERATE TARGET UID (ADDED)
        const targetUid = await generateTargetUid(distributor.dbCode);

        // GLOBAL TARGET
        if (!brandColumn) {

          const primaryTarget = await PrimaryTarget.create({

            name,
            distributorId: distributor._id,
            targetUid, // ✅ ADDED
            brandId: [],
            subBrandId: [],
            target_type,
            targetValue,
            targetVolume,
            target_start_date: start,
            target_end_date: end,
            stateId,
            regionId,
            zoneId,
            created_by: req.user._id,

          });

          let achievement = 0;

          const confirmedBills = await Invoice.find({
            distributorId: distributor._id,
            status: "Confirmed",
            date: { $gte: start, $lte: end },
          }).populate({
            path: "lineItems.product",
            select: "brand subBrand",
          });

          const billsUsedForTarget = new Set();

          for (const bill of confirmedBills) {

            for (const item of bill.lineItems || []) {

              const product = item.product;
              if (!product) continue;

              if (target_type === "value") {
                achievement += Number(bill.totalInvoiceAmount || 0);
                billsUsedForTarget.add(bill._id.toString());
                break;
              }

              if (target_type === "volume") {
                achievement += Number(item.receivedQty || 0);
                billsUsedForTarget.add(bill._id.toString());
              }

            }

          }

          if (achievement > 0) {
            await PrimaryTarget.findByIdAndUpdate(
              primaryTarget._id,
              { $inc: { achivedTarget: achievement } }
            );
          }

          if (billsUsedForTarget.size > 0) {
            await Invoice.updateMany(
              { _id: { $in: Array.from(billsUsedForTarget) } },
              { $addToSet: { targetIds: primaryTarget._id } }
            );
          }

          inserted++;
          continue;

        }

        let brands = [];
        let brandError = false;
        let brandErrorMessages = [];

        const brandCodes = brandColumn.split(",").map((b) => b.trim());

        for (const code of brandCodes) {

          const brand = await findByCodeOrSlug(Brand, code);

          if (!brand) {
            brandError = true;
            brandErrorMessages.push(`Invalid Brand Code: ${code}`);
          } else {
            brands.push(brand);
          }

        }

        if (brandError) {
          failedRows.push({
            ...originalRow,
            "Error Reason": brandErrorMessages.join(", "),
            "Row Number": i + 2,
          });
          continue;
        }
        if (brandError) continue;

        let subBrands = [];
        let subBrandError = false;

        if (subBrandColumn) {

          const subBrandCodes = subBrandColumn.split(",").map(s => s.trim());

          for (const code of subBrandCodes) {

            const subBrand = await findByCodeOrSlug(SubBrand, code);

            if (!subBrand) {

              failedRows.push({
                ...row,
                SubBrand: subBrandColumn,
                "Error Reason": `Invalid SubBrand Code: ${code}`,
                "Row Number": i + 2,
              });

              subBrandError = true;

            } else {

              subBrands.push(subBrand);

            }

          }

        }

        if (subBrandError) continue;

        const distributorBrandIds = distributor.brandId.map(id => id.toString());

        let mappingError = false;

        for (const brand of brands) {

          if (!distributorBrandIds.includes(brand._id.toString())) {

            failedRows.push({
              ...row,
              Brand: brandColumn,
              "Error Reason": `Brand ${brand.code} not mapped with distributor`,
              "Row Number": i + 2,
            });

            mappingError = true;

          }

        }

        if (mappingError) continue;

        const overlappingTarget = await PrimaryTarget.findOne({

          distributorId: distributor._id,
          brandId: { $in: brands.map(b => b._id) },
          $and: [
            { target_start_date: { $lte: end } },
            { target_end_date: { $gte: start } },
          ],

        });

        if (overlappingTarget) {

          failedRows.push({
            ...row,
            Brand: brandColumn,
            "Error Reason":
              `Target already exists for Distributor ${distributor.dbCode} and selected brands`,
            "Row Number": i + 2,
          });

          continue;

        }

        const primaryTarget = await PrimaryTarget.create({

          name,
          distributorId: distributor._id,
          targetUid, // ✅ ADDED
          brandId: brands.map(b => b._id),
          subBrandId: subBrands.map(sb => sb._id),
          target_type,
          targetValue,
          targetVolume,
          target_start_date: start,
          target_end_date: end,
          stateId,
          regionId,
          zoneId,
          created_by: req.user._id,

        });

        let achievement = 0;

        const confirmedBills = await Invoice.find({

          distributorId: distributor._id,
          status: "Confirmed",
          date: { $gte: start, $lte: end },

        }).populate({

          path: "lineItems.product",
          select: "brand subBrand",

        });

        const billsUsedForTarget = new Set();

        const brandIds = brands.map(b => b._id.toString());
        const subBrandIds = subBrands.map(sb => sb._id.toString());

        for (const bill of confirmedBills) {

          for (const item of bill.lineItems || []) {

            const product = item.product;
            if (!product) continue;

            if (brandIds.length && !brandIds.includes(product.brand?.toString()))
              continue;

            if (subBrandIds.length > 0) {

              if (!product.subBrand) continue;

              if (!subBrandIds.includes(product.subBrand.toString()))
                continue;

            }

            if (target_type === "value") {
              achievement += Number(item.netAmount || 0);
              billsUsedForTarget.add(bill._id.toString());
            }

            if (target_type === "volume") {
              achievement += Number(item.receivedQty || 0);
              billsUsedForTarget.add(bill._id.toString());
            }

          }

        }

        if (achievement > 0) {

          await PrimaryTarget.findByIdAndUpdate(
            primaryTarget._id,
            { $inc: { achivedTarget: achievement } }
          );

        }

        if (billsUsedForTarget.size > 0) {

          await Invoice.updateMany(
            { _id: { $in: Array.from(billsUsedForTarget) } },
            { $addToSet: { targetIds: primaryTarget._id } }
          );

        }

        inserted++;

      } catch (rowError) {

        failedRows.push({
          ...row,
          "Error Reason": rowError.message,
          "Row Number": i + 2,
        });

      }

    }

    let failedCSV = null;

    if (failedRows.length > 0) {

      const parser = new Parser();
      const csv = parser.parse(failedRows);
      failedCSV = Buffer.from(csv).toString("base64");

    }

    return res.status(200).json({

      message: "Bulk upload completed",
      inserted,
      updated,
      failed: failedRows.length,
      failedCSV,

    });

  } catch (err) {

    return res.status(500).json({
      message: err.message,
    });

  }

});

module.exports = { bulkUploadPrimaryTargets };