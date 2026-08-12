const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");
const State = require("../../models/state.model");
const Employee = require("../../models/employee.model");
const Region = require("../../models/region.model");
const moment = require("moment-timezone");

/* =============================
   HELPERS (UNCHANGED)
============================== */
const isValidIndianMobile = (mobile) => {
  if (!mobile) return true;
  return /^[6-9]\d{9}$/.test(mobile.toString().trim());
};

const normalize = (v) =>
  v.toString().replace(/\s+/g, " ").trim();

const parseCsvList = (value) =>
  normalize(value)
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);

const parseSourceIds = (value) => {
  if (!value) return [];
  return value
    .toString()
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
};

/* =============================
   ENUMS (matches OutletApproved schema)
============================== */
const VALID_POTENTIAL_SELECTIONS = [
  "Below 1 Lac",
  "Upto 3 Lac",
  "Upto 5 Lac",
  "Upto 10 Lac",
  "10 Lac & Above",
];

const VALID_PAYMENT_CATEGORIES = [
  "Good",
  "Normal",
  "Follow up",
  "Continuous Red",
];

const VALID_CATEGORIES_OF_OUTLET = [
  "Retail",
  "Wholesale",
  "Project Consumer",
  "Others",
];

const BIRTHDAY_FORMATS = [
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "MM-DD-YYYY",
];

/* =============================
   BULK OUTLET MODIFICATION
============================== */
const bulkOutletModification = asyncHandler(async (req, res) => {
  console.log("Bulk Outlet Modification initiated");
  const rows = req.body.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400);
    throw new Error("Bulk data must be a non-empty array");
  }

  const totalCount = rows.length;
  const errorRows = [];

  let successCount = 0;   // validation passed
  let insertedCount = 0;  // actual DB updated

  for (const row of rows) {
    const rowErrors = [];

    try {
      /* =============================
      OUTLET CODE (IDENTIFIER)
   ============================== */
      const outletCode = row["Outlet Code"]?.toString().trim();

      if (!outletCode) {
        rowErrors.push("Outlet Code missing");
        throw new Error();
      }

      const outlet = await OutletApproved.findOne({
        outletCode: normalize(outletCode),
      });

      if (!outlet) {
        rowErrors.push(`Outlet Code not found: ${outletCode}`);
        throw new Error();
      }

      // 🔹 Track changes
      const originalData = outlet.toObject();
      let isUpdated = false;


      /* =============================
         MOBILE VALIDATION
      ============================== */
      if (row["Mobile Number"]?.toString().trim()) {
        const mobile = normalize(row["Mobile Number"]);

        if (!isValidIndianMobile(mobile)) {
          rowErrors.push(`Invalid Indian Mobile Number: ${mobile}`);
        } else {
          const exists = await OutletApproved.findOne({
            mobile1: mobile,
            status: true,
            _id: { $ne: outlet._id },
          });

          if (exists) {
            rowErrors.push("Active outlet exists for this mobile number");
          } else if (outlet.mobile1 !== mobile) {
            outlet.mobile1 = mobile;
            isUpdated = true;
          }
        }
      }

      /* =============================
         BASIC FIELD UPDATES
      ============================== */
      const updatableFields = {
        outletName: "Outlet Name",
        sudoName: "Sudo Name",
        ownerName: "Owner Name",
        createdBy: "Created By",  
        mobile2: "Alternate Number",
        whatsappNumber: "WhatsApp Number",
        email: "Email",
        address1: "Address",
        pin: "Pincode",
        city: "City",
        aadharNumber: "Aadhar Number",
        panNumber: "PAN Number",
        gstin: "GSTIN",
        retailerClass: "Retailer Class",
        cso: "CSO",
      };

      Object.entries(updatableFields).forEach(([dbKey, csvKey]) => {
        if (row[csvKey]?.toString().trim()) {
          const value = normalize(row[csvKey]);
          if (outlet[dbKey] !== value) {
            outlet[dbKey] = value;
            isUpdated = true;
          }
        }
      });

      /* =============================
         POTENTIAL (potentialSelection)
      ============================== */
      if (row["Potential"]?.toString().trim()) {
        const potentialSelection = normalize(row["Potential"]);

        if (!VALID_POTENTIAL_SELECTIONS.includes(potentialSelection)) {
          rowErrors.push(
            `Invalid Potential: ${potentialSelection}. Must be one of: ${VALID_POTENTIAL_SELECTIONS.join(
              ", "
            )}`
          );
        } else if (outlet.potentialSelection !== potentialSelection) {
          outlet.potentialSelection = potentialSelection;
          isUpdated = true;
        }
      }

      /* =============================
         PAYMENT CATEGORY
      ============================== */
      if (row["Payment Category"]?.toString().trim()) {
        const paymentCategory = normalize(row["Payment Category"]);

        if (!VALID_PAYMENT_CATEGORIES.includes(paymentCategory)) {
          rowErrors.push(
            `Invalid Payment Category: ${paymentCategory}. Must be one of: ${VALID_PAYMENT_CATEGORIES.join(
              ", "
            )}`
          );
        } else if (outlet.paymentCategory !== paymentCategory) {
          outlet.paymentCategory = paymentCategory;
          isUpdated = true;
        }
      }

      /* =============================
         CATEGORY OF OUTLET (multi-value)
      ============================== */
      if (row["Category of Outlet"]?.toString().trim()) {
        const categoryOfOutlet = parseCsvList(row["Category of Outlet"]);

        const invalidCategories = categoryOfOutlet.filter(
          (cat) => !VALID_CATEGORIES_OF_OUTLET.includes(cat)
        );

        if (invalidCategories.length) {
          rowErrors.push(
            `Invalid Category of Outlet: ${invalidCategories.join(
              ", "
            )}. Must be one of: ${VALID_CATEGORIES_OF_OUTLET.join(", ")}`
          );
        } else {
          const newCategories = [...categoryOfOutlet].sort();
          const oldCategories = (outlet.categoryOfOutlet || [])
            .slice()
            .sort();

          if (
            JSON.stringify(newCategories) !== JSON.stringify(oldCategories)
          ) {
            outlet.categoryOfOutlet = categoryOfOutlet;
            isUpdated = true;
          }
        }
      }

      /* =============================
         BIRTHDAY
      ============================== */
      if (row["Birthday"]?.toString().trim()) {
        const birthdayRaw = normalize(row["Birthday"]);
        const parsedBirthday = moment(birthdayRaw, BIRTHDAY_FORMATS, true);

        if (!parsedBirthday.isValid()) {
          rowErrors.push(`Invalid Birthday format: ${birthdayRaw}`);
        } else {
          const newBirthday = parsedBirthday.toDate();
          const oldBirthday = outlet.birthday
            ? new Date(outlet.birthday)
            : null;

          if (!oldBirthday || oldBirthday.getTime() !== newBirthday.getTime()) {
            outlet.birthday = newBirthday;
            isUpdated = true;
          }
        }
      }

      /* =============================
         SOURCE ID (APPEND ONLY + GLOBAL UNIQUE, MULTI)
      ============================== */
      if (row["Source ID"]?.toString().trim()) {
        const newSourceIds = parseSourceIds(row["Source ID"]); // supports 1 or many

        const existingSourceIds = Array.isArray(outlet.massistRefIds)
          ? outlet.massistRefIds.map(String)
          : [];


        const conflicts = await OutletApproved.find({
          _id: { $ne: outlet._id }, // exclude current outlet
          massistRefIds: { $in: newSourceIds },
        }).select("outletUID massistRefIds");

        if (conflicts.length > 0) {
          // find exactly which IDs are conflicting
          const conflictingIds = new Set();
          conflicts.forEach(doc => {
            doc.massistRefIds.forEach(id => {
              if (newSourceIds.includes(id.toString())) {
                conflictingIds.add(id.toString());
              }
            });
          });

          rowErrors.push(
            `Source ID(s) already exist in another outlet: ${[
              ...conflictingIds,
            ].join(", ")}`
          );
        } else {
          const mergedSourceIds = [
            ...new Set([...existingSourceIds, ...newSourceIds]),
          ];

          if (mergedSourceIds.length !== existingSourceIds.length) {
            outlet.massistRefIds = mergedSourceIds;
            isUpdated = true;
          }
        }
      }

      /* =============================
      STATE VALIDATION (MULTI-ROW SAFE)
   ============================== */
      if (row["State"]?.toString().trim()) {
        const stateCode = normalize(row["State"])
          .replace(/\u00A0/g, " ")
          .replace(/\s+/g, "")
          .toUpperCase();

        const state = await State.findOne({
          status: true,
          $or: [
            { alphaCode: new RegExp(`^${stateCode}$`, "i") },
            { slug: new RegExp(`^${stateCode}$`, "i") },
          ],
        });


        if (!state) {
          rowErrors.push(`Invalid State: ${stateCode}`);
        } else {
          let beatsForValidation = [];

          // CASE 1: CSV has Beat Code(s)
          if (row["Beat Code"]?.toString().trim()) {
            const beatCodes = parseCsvList(row["Beat Code"]);

            beatsForValidation = await Beat.find({
              code: { $in: beatCodes },
              status: true,
            }).select("regionId");
          }
          // CASE 2: CSV has NO Beat → use DB beats
          else if (outlet.beatId?.length) {
            beatsForValidation = await Beat.find({
              _id: { $in: outlet.beatId },
              status: true,
            }).select("regionId");
          }

          if (!beatsForValidation.length) {
            rowErrors.push(
              `No Beat found to validate State ${stateCode}`
            );
          } else {
            // Resolve regions
            const regionIds = beatsForValidation
              .map(b => b.regionId)
              .filter(Boolean);

            const regions = await Region.find({
              _id: { $in: regionIds },
              status: true,
            }).select("stateId");

            const isMapped = regions.some(
              r => r.stateId?.toString() === state._id.toString()
            );

            if (!isMapped) {
              rowErrors.push(
                `State ${stateCode} not mapped with any Beat (via Region)`
              );
            } else if (
              !outlet.stateId ||
              outlet.stateId.toString() !== state._id.toString()
            ) {
              outlet.stateId = state._id;
              isUpdated = true;
            }
          }
        }
      }

      /* =============================
         EMPLOYEE + REGION + BEAT
      ============================== */
      const hasEmployee = Boolean(row["Employee Code"]?.toString().trim());
      const hasRegion = Boolean(row["Region"]?.toString().trim());
      const hasBeat = Boolean(row["Beat Code"]?.toString().trim());

      let employee = null;

      if (hasEmployee) {
        employee = await Employee.findOne({
          empId: normalize(row["Employee Code"]),
          status: true,
        });

        if (!employee) {
          rowErrors.push(`Employee not found: ${row["Employee Code"]}`);
        } else if (
          !outlet.employeeId ||
          outlet.employeeId.toString() !== employee._id.toString()
        ) {
          outlet.employeeId = employee._id;
          isUpdated = true;
        }
      } else if (outlet.employeeId) {
        employee = await Employee.findById(outlet.employeeId);
      }

      /* -------- REGION VALIDATION -------- */
      if (hasRegion) {
        if (!employee) {
          rowErrors.push("Employee Code is required for Region mapping");
        } else {
          const employeeRegionIds = Array.isArray(employee.regionId)
            ? employee.regionId.map(id => id.toString())
            : employee.regionId
              ? [employee.regionId.toString()]
              : [];

          const regionValues = parseCsvList(row["Region"]);

          const regions = await Region.find({
            status: true,
            $or: [
              { name: { $in: regionValues.map(v => new RegExp(`^${v}$`, "i")) } },
              { code: { $in: regionValues.map(v => new RegExp(`^${v}$`, "i")) } },
            ],
          });

          const missing = regionValues.filter(
            r =>
              !regions.some(
                rg =>
                  rg.name.toLowerCase() === r.toLowerCase() ||
                  rg.code?.toLowerCase() === r.toLowerCase()
              )
          );

          if (missing.length) {
            rowErrors.push(`Invalid Region(s): ${missing.join(", ")}`);
          }


          const unmatched = regions.filter(
            r => !employeeRegionIds.includes(r._id.toString())
          );

          if (unmatched.length) {
            rowErrors.push(
              `Employee ${employee.empId} not mapped with Region(s): ${unmatched
                .map(r => r.name)
                .join(", ")}`
            );
          }

          if (!missing.length && !unmatched.length) {
            const newRegionIds = regions.map(r => r._id.toString()).sort();
            const oldRegionIds = (outlet.regionId || [])
              .map(id => id.toString())
              .sort();

            if (JSON.stringify(newRegionIds) !== JSON.stringify(oldRegionIds)) {
              outlet.regionId = regions.map(r => r._id);
              isUpdated = true;
            }
          }
        }
      }

      /* -------- BEAT VALIDATION --------
         Employee ↔ Beat mapping is NOT required.
         Only check that the Beat exists and is active.
      ----------------------------------- */
      if (hasBeat) {
        const beatCodes = parseCsvList(row["Beat Code"]);

        const beats = await Beat.find({
          code: { $in: beatCodes },
          status: true,
        });

        const foundCodes = beats.map(b => b.code);
        const missing = beatCodes.filter(
          code => !foundCodes.includes(code)
        );

        if (missing.length) {
          rowErrors.push(
            `Beat not found: ${missing.join(", ")}`
          );
        } else {
          const newBeatIds = beats.map(b => b._id.toString()).sort();
          const oldBeatIds = (outlet.beatId || [])
            .map(id => id.toString())
            .sort();

          if (JSON.stringify(newBeatIds) !== JSON.stringify(oldBeatIds)) {
            outlet.beatId = beats.map(b => b._id);
            isUpdated = true;
          }
        }
      }

      /* =============================
         FINAL DECISION
      ============================== */
      if (rowErrors.length) {
        errorRows.push({
          ...row,
          Reason: rowErrors.join(" / "),
        });
        continue;
      }

      successCount++;

      if (isUpdated) {
        outlet.shipToAddress = null;
        outlet.shipToPincode = null;
        // if (outlet.status === false) outlet.status = true;

        await outlet.save();
        insertedCount++;
      }

    } catch (err) {
      errorRows.push({
        ...row,
        Reason: rowErrors.length
          ? rowErrors.join(" / ")
          : "Unexpected error occurred",
      });
    }
  }

  const failedCount = errorRows.length;
  const successRows = totalCount - failedCount;

  let message = `${successRows} success, ${insertedCount} inserted`;


  res.json({
    success: true,
    message,
    total: totalCount,
    successCount: successRows,
    insertedCount,
    failedCount,
    failedRows: errorRows,
  });
});

module.exports = { bulkOutletModification };