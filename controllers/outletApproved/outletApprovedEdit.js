const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model.js");
const Beat = require("../../models/beat.model.js");
const mongoose = require("mongoose");
const Employee = require("../../models/employee.model.js")

const isValidIndianMobile = (mobile) => {
  if (!mobile) return true;
  const cleaned = mobile.toString().trim();
  return /^[0-9]\d{9}$/.test(cleaned);
};

const outletApprovedEdit = asyncHandler(async (req, res) => {

  try {
    const { outletAppId } = req.params;
    console.log(req.body, 'req.body')
    // ---------------- BASIC VALIDATION (UNCHANGED) ----------------
    if (!mongoose.Types.ObjectId.isValid(outletAppId)) {
      res.status(400);
      throw new Error("Invalid outlet ID");
    }

    const outlet = await OutletApproved.findById(outletAppId);
    if (!outlet) {
      res.status(404);
      throw new Error("Outlet not found");
    }

    if (!isValidIndianMobile(req.body.mobile1)) {
      res.status(400);
      throw new Error("Invalid Mobile 1.");
    }

    if (!isValidIndianMobile(req.body.mobile2)) {
      res.status(400);
      throw new Error("Invalid Mobile 2.");
    }

    if (!isValidIndianMobile(req.body.whatsappNumber)) {
      res.status(400);
      throw new Error("Invalid WhatsApp Number.");
    }

    // ---------------- GST VALIDATION ----------------
    if (req.body.gstin) {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(req.body.gstin)) {
        res.status(400);
        throw new Error("Invalid GSTIN format");
      }
    }

    // ---------------- PAN VALIDATION ----------------
    if (req.body.panNumber) {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(req.body.panNumber)) {
        res.status(400);
        throw new Error("Invalid PAN number format");
      }
    }

    // ---------------- AADHAR VALIDATION ----------------
    if (req.body.aadharNumber) {
      if (!/^\d{12}$/.test(req.body.aadharNumber)) {
        res.status(400);
        throw new Error("Invalid Aadhaar number format");
      }
    }

    // ---------------- EMAIL VALIDATION ----------------
    if (req.body.email) {
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(req.body.email)) {
        res.status(400);
        throw new Error("Invalid email format");
      }
    }

    // ---------------- PINCODE VALIDATION ----------------
    if (req.body.pin) {
      if (!/^[1-9][0-9]{5}$/.test(req.body.pin)) {
        res.status(400);
        throw new Error("Invalid pincode format");
      }
    }

    // ---------------- POTENTIAL SELECTION VALIDATION (matches model enum) ----------------
    const validPotentialSelections = [
      "Below 1 Lac",
      "Upto 3 Lac",
      "Upto 5 Lac",
      "Upto 10 Lac",
      "10 Lac & Above",
      "Survey",
    ];

    let potentialSelectionToUpdate;

    if (req.body.potentialSelection !== undefined) {
      if (req.body.potentialSelection === null || req.body.potentialSelection === "") {
        potentialSelectionToUpdate = null;
      } else {
        const potentialSelection = req.body.potentialSelection.toString().trim();

        if (!validPotentialSelections.includes(potentialSelection)) {
          res.status(400);
          throw new Error(
            `Invalid potential selection. Allowed values: ${validPotentialSelections.join(", ")}`
          );
        }

        potentialSelectionToUpdate = potentialSelection;
      }
    }

    // ---------------- PAYMENT CATEGORY VALIDATION (matches model enum) ----------------
    const validPaymentCategories = ["Good", "Normal", "Follow Up", "RED", "Survey"];

    let paymentCategoryToUpdate;

    if (req.body.paymentCategory !== undefined) {
      if (req.body.paymentCategory === null || req.body.paymentCategory === "") {
        paymentCategoryToUpdate = null;
      } else {
        const paymentCategory = req.body.paymentCategory.toString().trim();

        if (!validPaymentCategories.includes(paymentCategory)) {
          res.status(400);
          throw new Error(
            `Invalid payment category. Allowed values: ${validPaymentCategories.join(", ")}`
          );
        }

        paymentCategoryToUpdate = paymentCategory;
      }
    }

    // ---------------- BIRTHDAY VALIDATION (NEW, OPTIONAL) ----------------
    let birthdayToUpdate;

    if (req.body.birthday !== undefined) {
      if (req.body.birthday === null || req.body.birthday === "") {
        birthdayToUpdate = null;
      } else {
        const parsedBirthday = new Date(req.body.birthday);

        if (isNaN(parsedBirthday.getTime())) {
          res.status(400);
          throw new Error("Invalid birthday. Expected format: YYYY-MM-DD");
        }

        birthdayToUpdate = parsedBirthday;
      }
    }

    // ---------------- CATEGORY OF OUTLET VALIDATION (matches model enum/array) ----------------
    // Case-insensitive match against the canonical enum, and silently drop
    // any legacy/unknown values instead of blocking the whole edit request.
    // This lets outlets with old dirty data (e.g. "RETAILER" from before the
    // enum was tightened) get cleaned up automatically on the next save,
    // rather than becoming permanently un-editable.
    const validCategoriesOfOutlet = ["Retail", "Wholesale", "Project", "Consumer", "Survey"];

    let categoryOfOutletToUpdate;

    if (req.body.categoryOfOutlet !== undefined) {
      let categoryOfOutletRaw = [];

      if (Array.isArray(req.body.categoryOfOutlet)) {
        categoryOfOutletRaw = req.body.categoryOfOutlet
          .map((item) => item?.toString().trim())
          .filter(Boolean);
      } else if (req.body.categoryOfOutlet) {
        categoryOfOutletRaw = req.body.categoryOfOutlet
          .toString()
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }

      const normalizedCategoryOfOutlet = [];
      const droppedCategories = [];

      categoryOfOutletRaw.forEach((cat) => {
        const match = validCategoriesOfOutlet.find(
          (valid) => valid.toLowerCase() === cat.toLowerCase()
        );
        if (match) {
          if (!normalizedCategoryOfOutlet.includes(match)) {
            normalizedCategoryOfOutlet.push(match);
          }
        } else {
          droppedCategories.push(cat);
        }
      });

      if (droppedCategories.length > 0) {
        console.warn(
          `Outlet ${outletAppId}: dropped invalid categoryOfOutlet value(s) [${droppedCategories.join(
            ", "
          )}] on edit`
        );
      }

      categoryOfOutletToUpdate = normalizedCategoryOfOutlet;
    }

    // =========================================================
    // PHONE NUMBER GLOBAL UNIQUENESS CHECK (ACTIVE OUTLETS ONLY)
    // =========================================================

    const phoneFields = ["mobile1", "mobile2", "whatsappNumber"];

    // collect NEW phone numbers only
    const phoneNumbersToCheck = [];

    phoneFields.forEach((field) => {
      if (req.body[field]) {
        const newNumber = req.body[field].toString().trim();
        const existingNumber = outlet[field]?.toString().trim();

        // only check if number is changed
        if (newNumber && newNumber !== existingNumber) {
          phoneNumbersToCheck.push(newNumber);
        }
      }
    });

    if (phoneNumbersToCheck.length > 0) {
      const duplicateOutlet = await OutletApproved.findOne({
        _id: { $ne: outletAppId },
        status: true,
        $or: [
          { mobile1: { $in: phoneNumbersToCheck } },
          { mobile2: { $in: phoneNumbersToCheck } },
          { whatsappNumber: { $in: phoneNumbersToCheck } },
        ],
      }).select("outletCode outletName mobile1 mobile2 whatsappNumber");

      if (duplicateOutlet) {
        res.status(400);
        throw new Error(
          `Phone number already exists in another active outlet (Outlet Code: ${duplicateOutlet.outletCode})`
        );
      }
    }

    // ---------------- BEAT VALIDATION (UNCHANGED) ----------------
    if (req.body.beatId !== undefined) {
      if (Array.isArray(req.body.beatId)) {
        for (const id of req.body.beatId) {
          if (!mongoose.Types.ObjectId.isValid(id)) {
            res.status(400);
            throw new Error("Invalid beat ID");
          }
          const beat = await Beat.findById(id);
          if (!beat) {
            res.status(404);
            throw new Error("Beat not found");
          }
        }
      } else if (mongoose.Types.ObjectId.isValid(req.body.beatId)) {
        const beat = await Beat.findById(req.body.beatId);
        if (!beat) {
          res.status(404);
          throw new Error("Beat not found");
        }
      } else if (req.body.beatId !== null && req.body.beatId !== "") {
        res.status(400);
        throw new Error("Invalid beat ID");
      }
    }

    const updateFields = {};

    // ---------------- EMPLOYEE VALIDATION ----------------
    if (req.body.empId !== undefined) {
      const empId = req.body.empId?.toString().trim();

      if (!empId) {
        res.status(400);
        throw new Error("Employee ID is required");
      }

      // Only lookup if employee has actually changed
      const currentEmployee = outlet.employeeId
        ? await Employee.findById(outlet.employeeId).select("empId")
        : null;

      if (currentEmployee?.empId !== empId) {
        const employee = await Employee.findOne({ empId });

        if (!employee) {
          res.status(404);
          throw new Error(`Employee not found with Employee ID: ${empId}`);
        }

        updateFields.employeeId = employee._id;
      }
    }
    // ---------------- ALLOWED FIELDS (ONLY ADD massistRefIds) ----------------
    const allowedFields = [
      "outletName",
      "sudoName",
      "ownerName",
      "createdBy",
      "cso",
      "pin",
      "mobile1",
      "mobile2",
      "whatsappNumber",
      "preferredLanguage",
      "teleCallDay",
      "address1",
      "address2",
      "marketCenter",
      "city",
      "aadharNumber",
      "panNumber",
      "gstin",
      "location",
      "gpsLocation",
      "contactPerson",
      "email",
      "retailerClass",
      "enrolledStatus",
      "shipToAddress",
      "shipToPincode",
      "competitorBrands",
      "massistRefIds",
      "googleMapLink",
    ];

    allowedFields.forEach((field) => {
      if (
        req.body[field] !== undefined &&
        req.body[field] !== null
      ) {
        // Allow gstin, panNumber, aadharNumber, email to be updated with empty strings
        if (field === 'gstin' || field === 'panNumber' || field === 'aadharNumber') {
          updateFields[field] = req.body[field];
        } else if (req.body[field] !== "") {
          updateFields[field] = req.body[field];
        }
      }
    });

    // ---------------- NEW FIELDS: potentialSelection, paymentCategory, birthday, categoryOfOutlet ----------------
    if (potentialSelectionToUpdate !== undefined) {
      updateFields.potentialSelection = potentialSelectionToUpdate;
    }

    if (paymentCategoryToUpdate !== undefined) {
      updateFields.paymentCategory = paymentCategoryToUpdate;
    }

    if (birthdayToUpdate !== undefined) {
      updateFields.birthday = birthdayToUpdate;
    }

    if (categoryOfOutletToUpdate !== undefined) {
      updateFields.categoryOfOutlet = categoryOfOutletToUpdate;
    }

    // ---------------- OBJECT ID FIELDS (UNCHANGED) ----------------
    const objectIdFields = {
      beatId: "Beat",
      stateId: "State",
      regionId: "Region",
      zoneId: "Zone",
      district: "District",
      employeeId: "Employee",
    };

    Object.keys(objectIdFields).forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === "beatId") {
          if (Array.isArray(req.body[field])) {
            updateFields[field] = req.body[field].map(
              (id) => new mongoose.Types.ObjectId(id)
            );
          } else if (mongoose.Types.ObjectId.isValid(req.body[field])) {
            updateFields[field] = [
              new mongoose.Types.ObjectId(req.body[field]),
            ];
          } else if (req.body[field] === null || req.body[field] === "") {
            updateFields[field] = [];
          }
        } else {
          if (mongoose.Types.ObjectId.isValid(req.body[field])) {
            updateFields[field] = req.body[field];
          } else if (req.body[field] === null || req.body[field] === "") {
            updateFields[field] = null;
          }
        }
      }
    });

    // ---------------- OTHER VALIDATIONS (UNCHANGED) ----------------
    if (req.body.sellingBrands !== undefined) {
      if (Array.isArray(req.body.sellingBrands)) {
        updateFields.sellingBrands = req.body.sellingBrands.filter((id) =>
          mongoose.Types.ObjectId.isValid(id)
        );
      }
    }

    if (req.body.teleCallingSlot !== undefined) {
      if (Array.isArray(req.body.teleCallingSlot)) {
        updateFields.teleCallingSlot = req.body.teleCallingSlot;
      }
    }

    if (
      req.body.retailerClass &&
      !["A", "B", "C", "D"].includes(req.body.retailerClass)
    ) {
      res.status(400);
      throw new Error("Invalid retailer class");
    }

    // if (
    //   req.body.enrolledStatus &&
    //   !["ENROLLED", "NOT ENROLLED"].includes(req.body.enrolledStatus)
    // ) {
    //   res.status(400);
    //   throw new Error("Invalid enrolled status");
    // }

    // =========================================================
    // SOURCE ID DEDUPLICATION + OUTLET CODE PROTECTION
    // =========================================================

    // if (Array.isArray(req.body.massistRefIds)) {

    //   const cleanedSourceIds = [
    //     ...new Set(
    //       req.body.massistRefIds
    //         .map((id) => id?.toString().trim())
    //         .filter(Boolean)
    //     ),
    //   ];

    //   // ❌ Prevent removal of outletCode from massistRefIds
    //   if (
    //     outlet.outletCode &&
    //     !cleanedSourceIds.includes(outlet.outletCode.toString())
    //   ) {
    //     res.status(400);
    //     throw new Error(
    //       `Outlet Code (${outlet.outletCode}) cannot be removed from Source IDs`
    //     );
    //   }

    //   updateFields.massistRefIds = cleanedSourceIds;
    // }

    //find only NEW source IDs
    // let newSourceIdsToCheck = [];

    // if (Array.isArray(updateFields.massistRefIds)) {
    //   const existingSourceIds =
    //     outlet.massistRefIds?.map((id) => id.toString()) || [];

    //   newSourceIdsToCheck = updateFields.massistRefIds.filter(
    //     (id) => !existingSourceIds.includes(id)
    //   );
    // }

    // =========================================================
    //  GLOBAL SOURCE ID UNIQUENESS CHECK
    // =========================================================
    // if (
    //   Array.isArray(updateFields.massistRefIds) &&
    //   updateFields.massistRefIds.length > 0
    // ) {
    //   const duplicateOutlet = await OutletApproved.findOne({
    //     _id: { $ne: outletAppId },
    //     massistRefIds: { $in: updateFields.massistRefIds },
    //   }).select("outletCode outletName");

    //   if (duplicateOutlet) {
    //     res.status(400);
    //     throw new Error(
    //       `Source ID already exists in another outlet (Outlet Code: ${duplicateOutlet.outletCode})`
    //     );
    //   }
    // }

    // if (newSourceIdsToCheck.length > 0) {
    //   const duplicateOutlet = await OutletApproved.findOne({
    //     _id: { $ne: outletAppId },
    //     status: true,
    //     massistRefIds: { $in: newSourceIdsToCheck },
    //   }).select("outletCode outletName");

    //   if (duplicateOutlet) {
    //     res.status(400);
    //     throw new Error(
    //       `Source ID already exists in another outlet (Outlet Code: ${duplicateOutlet.outletCode})`
    //     );
    //   }
    // }


    // ---------------- UPDATE (UNCHANGED) ----------------
    const updatedOutlet = await OutletApproved.findByIdAndUpdate(
      outletAppId,
      updateFields,
      { new: true, runValidators: true }
    ).populate([
      { path: "employeeId", select: "name empId" },
      { path: "beatId", select: "name code" },
      { path: "stateId", select: "name stateCode" },
      { path: "regionId", select: "name code" },
      { path: "zoneId", select: "name zoneCode" },
      { path: "district", select: "name districtCode" },
      { path: "sellingBrands", select: "name brandCode" },
    ]);

    res.status(200).json({
      success: true,
      message: "Outlet updated successfully",
      data: updatedOutlet,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { outletApprovedEdit };