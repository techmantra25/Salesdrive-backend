const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");
const Employee = require("../../models/employee.model");
const Beat = require("../../models/beat.model");
const Zone = require("../../models/zone.model");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const District = require("../../models/district.model");
const Brand = require("../../models/brand.model");
const Distributor = require("../../models/distributor.model");
const OutletApproved = require("../../models/outletApproved.model");


const { generateCode } = require("../../utils/codeGenerator");

const createSingleOutlet = asyncHandler(async (req, res) => {
  try {
    const data = req.body;
    console.log("CREATE SINGLE OUTLET - DATA RECEIVED", data);

    // =========================
    // MOBILE HELPERS
    // =========================

    const getMobile1 = () =>
      (data.mobile1 ||
        data["Mobile Number"] ||
        data["Mobile 1"] ||
        "")
        .toString()
        .trim();

    const getMobile2 = () =>
      (data.mobile2 ||
        data["Alternate Number"] ||
        data["Mobile 2"] ||
        "")
        .toString()
        .trim();

    // =========================
    // REQUIRED FIELD VALIDATION
    // =========================

    const requiredFields = [
      "outletName",
      "ownerName",
      "employeeCode",
      "beatCode",
      "stateCode",
    ];

    const missingFields = requiredFields.filter(
      (field) => !data[field]
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        status: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // =========================
    // EMPLOYEE VALIDATION
    // =========================

    const employee = await Employee.findOne({
      empId: data.employeeCode.trim(),
    });

    if (!employee) {
      return res.status(400).json({
        status: false,
        message: "Employee not found",
      });
    }

    // =========================
    // STATE VALIDATION
    // =========================

    const state = await State.findOne({
      slug: data.stateCode.trim(),
    });

    if (!state) {
      return res.status(400).json({
        status: false,
        message: "State not found",
      });
    }

    // =========================
    // REGION LOOKUP
    // =========================

    const region = await Region.findOne({
      stateId: state._id,
    });

    // =========================
    // BEAT VALIDATION
    // =========================
    // =========================
    // BEAT VALIDATION
    // =========================

    const beatCodes = data.beatCode
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const beats = await Beat.find({
      code: { $in: beatCodes },
    }).select(
      "_id employeeId regionId distributorId"
    );

    if (beats.length !== beatCodes.length) {
      return res.status(400).json({
        status: false,
        message: "Invalid beat code",
      });
    }

    const beatIds = beats.map((beat) => beat._id);

    // =========================
    // EMPLOYEE + BEAT VALIDATION
    // =========================

    const employeeExistsInBeat = beats.some(
      (beat) =>
        beat.employeeId
          ?.map((id) => id.toString())
          .includes(employee._id.toString())
    );

    if (!employeeExistsInBeat) {
      return res.status(400).json({
        status: false,
        message:
          "Selected employee is not mapped with selected beat",
      });
    }

    // =========================
    // REGION VALIDATION
    // =========================

    const beatRegionIds = beats.map((beat) =>
      beat.regionId?.toString()
    );

    if (
      region &&
      !beatRegionIds.includes(
        region._id.toString()
      )
    ) {
      return res.status(400).json({
        status: false,
        message:
          "Selected state does not belong to beat region",
      });
    }

    // =========================
    // ZONE VALIDATION
    // =========================

    let zoneId = null;

    if (data.zoneCode) {
      const zone = await Zone.findOne({
        code: data.zoneCode.trim(),
      });

      if (!zone) {
        return res.status(400).json({
          status: false,
          message: "Zone not found",
        });
      }

      zoneId = zone._id;
    }

    // =========================
    // DISTRICT VALIDATION
    // =========================

    let districtId = null;

    if (data.districtCode) {
      const district = await District.findOne({
        code: data.districtCode.trim(),
      });

      if (!district) {
        return res.status(400).json({
          status: false,
          message: "District not found",
        });
      }

      districtId = district._id;
    }

    // =========================
    // DISTRIBUTOR VALIDATION
    // =========================

    let distributorId = null;

    if (data.distributorCode) {
      const distributor = await Distributor.findOne({
        dbCode: data.distributorCode.trim(),
      });

      if (!distributor) {
        return res.status(400).json({
          status: false,
          message: "Distributor not found",
        });
      }

      distributorId = distributor._id;
    }

    // =========================
    // MOBILE VALIDATION
    // =========================

    const mobile1 = getMobile1();

    if (mobile1) {
      const mobileRegex = /^[6-9]\d{9}$/;

      if (!mobileRegex.test(mobile1)) {
        return res.status(400).json({
          status: false,
          message:
            "Invalid mobile number. Must be 10 digit Indian mobile number",
        });
      }

      const existingMobile = await Outlet.findOne({
        mobile1,
      });

      if (existingMobile) {
        return res.status(400).json({
          status: false,
          message: "Mobile number already exists",
        });
      }
    }

    // =========================
    // AADHAR VALIDATION
    // =========================

    if (data.aadharNumber) {
      const aadharRegex = /^\d{12}$/;

      if (!aadharRegex.test(data.aadharNumber)) {
        return res.status(400).json({
          status: false,
          message: "Invalid Aadhaar number",
        });
      }
    }

    // =========================
    // PAN VALIDATION
    // =========================

    if (data.panNumber) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

      if (!panRegex.test(data.panNumber)) {
        return res.status(400).json({
          status: false,
          message: "Invalid PAN number",
        });
      }
    }

    // =========================
    // GST VALIDATION
    // =========================

    if (data.gstin) {
      const gstRegex =
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/i;

      if (!gstRegex.test(data.gstin)) {
        return res.status(400).json({
          status: false,
          message: "Invalid GSTIN",
        });
      }
    }

    // =========================
    // OUTLET CODE
    // =========================

    let outletCode = data.outletCode?.trim();

    if (!outletCode) {
      outletCode = await generateCode("OUT-CODE");
    }

    const existingOutletCode = await Outlet.findOne({
      outletCode,
    });

    if (existingOutletCode) {
      return res.status(400).json({
        status: false,
        message: "Outlet code already exists",
      });
    }

    const existingApprovedOutletCode = await OutletApproved.findOne({
      outletCode,
    });

    if (existingApprovedOutletCode) {
      return res.status(400).json({
        status: false,
        message: "Outlet code already exists in approved outlets",
      });
    }

    // =========================
    // OUTLET UID
    // =========================

    let outletUID = data.outletUID?.trim();

    if (!outletUID) {
      outletUID = await generateCode("OUT");
    }

    const existingOutletUID = await Outlet.findOne({
      outletUID,
    });

    if (existingOutletUID) {
      return res.status(400).json({
        status: false,
        message: "Outlet UID already exists",
      });
    }

    const existingApprovedOutletUID = await OutletApproved.findOne({
      outletUID,
    });

    if (existingApprovedOutletUID) {
      return res.status(400).json({
        status: false,
        message: "Outlet UID already exists in approved outlets",
      });
    }

    // =========================
    // BRAND VALIDATION
    // =========================

    let sellingBrands = [];

    if (data.brandCode) {
      const brandCodes = data.brandCode
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const brands = await Brand.find({
        code: { $in: brandCodes },
      });

      if (brands.length !== brandCodes.length) {
        return res.status(400).json({
          status: false,
          message: "Invalid brand code",
        });
      }

      sellingBrands = brands.map((brand) => brand._id);
    }

    // =========================
    // CATEGORY VALIDATION
    // =========================

    const validCategories = [
      "ECONOMY",
      "PREMIUM",
      "RETAILER",
    ];

    const categoryOfOutlet =
      data.categoryOfOutlet?.trim()?.toUpperCase() ||
      "RETAILER";

    if (!validCategories.includes(categoryOfOutlet)) {
      return res.status(400).json({
        status: false,
        message: `Invalid category. Allowed values: ${validCategories.join(
          ", "
        )}`,
      });
    }

    // =========================
    // EXISTING RETAILER
    // =========================

    let existingRetailerBool = false;

    if (data.existingRetailer) {
      const existingRetailer = data.existingRetailer
        .toString()
        .trim()
        .toUpperCase();

      if (["TRUE", "YES", "1"].includes(existingRetailer)) {
        existingRetailerBool = true;
      } else if (
        ["FALSE", "NO", "0"].includes(existingRetailer)
      ) {
        existingRetailerBool = false;
      } else {
        return res.status(400).json({
          status: false,
          message:
            "existingRetailer must be TRUE/FALSE YES/NO or 1/0",
        });
      }
    }

    // =========================
    // RETAILER CLASS VALIDATION
    // =========================

    const validRetailerClasses = ["A", "B", "C", "D"];

    const retailerClass = data.retailerClass
      ?.trim()
      ?.toUpperCase();

    if (
      retailerClass &&
      !validRetailerClasses.includes(retailerClass)
    ) {
      return res.status(400).json({
        status: false,
        message: `Invalid retailer class. Allowed values: ${validRetailerClasses.join(
          ", "
        )}`,
      });
    }

    // =========================
    // ENROLLED STATUS
    // =========================

    const validEnrolledStatuses = [
      "ENROLLED",
      "NOT ENROLLED",
    ];

    const enrolledStatus =
      data.enrolledStatus?.trim()?.toUpperCase() ||
      "NOT ENROLLED";

    if (
      !validEnrolledStatuses.includes(enrolledStatus)
    ) {
      return res.status(400).json({
        status: false,
        message: `Invalid enrolled status. Allowed values: ${validEnrolledStatuses.join(
          ", "
        )}`,
      });
    }

    // =========================
    // LEAD ID
    // =========================

    const leadId = await generateCode("LD");

    // =========================
    // CREATE OUTLET
    // =========================

    const outlet = await Outlet.create({
      leadId,

      employeeId: employee._id,

      zoneId,
      stateId: state._id,
      regionId: region?._id || null,
      distributorId,

      outletCode,
      outletUID,

      outletName: data.outletName.trim(),
      ownerName: data.ownerName.trim(),

      pin: data.pin || null,

      district: districtId,

      mobile1: mobile1 || null,
      mobile2: getMobile2() || null,

      whatsappNumber:
        data.whatsappNumber || null,

      preferredLanguage:
        data.preferredLanguage || null,

      teleCallDay:
        data.teleCallDay || null,

      beatId: beatIds,

      address1: data.address1 || null,
      address2: data.address2 || null,

      marketCenter:
        data.marketCenter || null,

      city: data.city || null,

      aadharNumber:
        data.aadharNumber || null,

      panNumber:
        data.panNumber || null,

      gstin: data.gstin || null,

      location: data.location || null,

      gpsLocation:
        data.gpsLocation || null,

      categoryOfOutlet,

      sellingBrands,

      competitorBrands: data.competitorBrands
        ? data.competitorBrands
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
        : [],

      existingRetailer:
        existingRetailerBool,

      outletStatus: "Pending",

      outletSource: "Admin",

      remarks: data.remarks || null,

      contactPerson:
        data.contactPerson || null,

      email: data.email || null,

      retailerClass:
        retailerClass || null,

      enrolledStatus,

      shipToAddress:
        data.shipToAddress || null,

      shipToPincode:
        data.shipToPincode || null,

      createdBy: req.user?._id || null,

      createdBy_type: req.user
        ? "User"
        : "Employee",
    });

    return res.status(201).json({
      status: true,
      message: "Outlet created successfully",
      data: outlet,
    });
  } catch (error) {
    console.log(
      "CREATE SINGLE OUTLET ERROR",
      error
    );

    return res.status(500).json({
      status: false,
      message:
        error.message || "Something went wrong",
    });
  }
});

module.exports = {
  createSingleOutlet,
};