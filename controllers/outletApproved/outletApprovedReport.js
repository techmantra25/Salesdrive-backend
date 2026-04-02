const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

/* ----------------------------------------
   SAFE RESOLVERS (NO LOGIC CHANGE)
---------------------------------------- */
const resolveBeatCodes = (beats) => {
  if (!beats) return "";

  if (Array.isArray(beats)) {
    return beats
      .map((b) => b?.code)
      .filter(Boolean)
      .join(", ");
  }

  return beats?.code || "";
};

const resolveRegionName = (outlet) => {
  if (outlet.regionId?.name) return outlet.regionId.name;
  if (Array.isArray(outlet.beatId))
    return outlet.beatId[0]?.regionId?.name || "";
  return outlet.beatId?.regionId?.name || "";
};
const resolveDistributorCode = (outlet) => {
  if (!outlet?.beatId) return "";

  const beats = Array.isArray(outlet.beatId)
    ? outlet.beatId
    : [outlet.beatId];

  const distributorCodeMap = new Map();

  beats.forEach((beat) => {
    if (Array.isArray(beat?.distributorId)) {
      beat.distributorId.forEach((dist) => {
        if (dist?._id && dist?.dbCode) {
          distributorCodeMap.set(dist._id.toString(), dist.dbCode);
        }
      });
    }
  });

  return Array.from(distributorCodeMap.values()).join(", ");
};

/* ----------------------------------------
   ✅ FIXED: DISTRIBUTOR RESOLVER
---------------------------------------- */
const resolveDistributorName = (outlet) => {
  if (!outlet?.beatId) return "";

  const beats = Array.isArray(outlet.beatId)
    ? outlet.beatId
    : [outlet.beatId];

  const distributorMap = new Map();

  beats.forEach((beat) => {
    if (Array.isArray(beat?.distributorId)) {
      beat.distributorId.forEach((dist) => {
        if (dist?._id && dist?.name) {
          distributorMap.set(dist._id.toString(), dist.name);
        }
      });
    }
  });

  return Array.from(distributorMap.values()).join(", ");
};

const resolveEmployeeName = (outlet) => {
  if (outlet.employeeId?.name) return outlet.employeeId.name;
  if (Array.isArray(outlet.beatId))
    return outlet.beatId[0]?.employeeId?.[0]?.name || "";
  return outlet.beatId?.employeeId?.[0]?.name || "";
};

const resolveSourceIds = (ids) => {
  if (!Array.isArray(ids)) return "";
  return [...new Set(ids)].join(", ");
};

const formatDate = (date) =>
  date ? moment(date).tz("Asia/Kolkata").format("DD-MM-YYYY") : "";

/* ----------------------------------------
   CONTROLLER
---------------------------------------- */
const outletApprovedReport = asyncHandler(async (req, res) => {
  try {
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Outlet_Master_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a"
    )}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    /* ----------------------------------------
       BUILD QUERY (UNCHANGED)
    ---------------------------------------- */
    const query = {};

    if (req.query.search) {
      query.$or = [
        { outletCode: { $regex: req.query.search, $options: "i" } },
        { outletUID: { $regex: req.query.search, $options: "i" } },
        { outletName: { $regex: req.query.search, $options: "i" } },
        { ownerName: { $regex: req.query.search, $options: "i" } },
      ];
    }

    if (req.query.statusFilter !== undefined) {
      if (
        req.query.statusFilter === "active" ||
        req.query.statusFilter === "true" ||
        req.query.statusFilter === true
      ) {
        query.status = true;
      } else if (
        req.query.statusFilter === "inactive" ||
        req.query.statusFilter === "false" ||
        req.query.statusFilter === false
      ) {
        query.status = false;
      }
    }

    if (req.query.stateId) {
      query.stateId = req.query.stateId;
    }

    if (req.query.distributorId) {
      const beats = await Beat.find(
        { distributorId: req.query.distributorId },
        { _id: 1 }
      ).lean();
      query.beatId = { $in: beats.map((b) => b._id) };
    }

    if (req.query.beatId) {
      query.beatId = req.query.beatId;
    }

    if (req.query.fromDate && req.query.toDate) {
      query.createdAt = {
        $gte: new Date(req.query.fromDate + "T00:00:00.000Z"),
        $lte: new Date(req.query.toDate + "T23:59:59.999Z"),
      };
    }

    /* ----------------------------------------
       CSV HEADERS
    ---------------------------------------- */
    const headers = [
      "Outlet UID",
      "Outlet Code",
      "Outlet Name",
      "Source Ids",
      "Merged Points",
      "Wallet Balance",
      "Owner Name",
      "Mobile Number",
      "Alternate Number",
      "WhatsApp Number",
      "Email",
      "Zone",
      "Region",
      "State",
      "District",
      "Beat",
      "Distributor",
      "Distributor Code",
      "Employee",
      "Address",
      "Pincode",
      "Shipping Address",
      "Shipping Pincode",
      "City",
      "Aadhar Number",
      "PAN Number",
      "GSTIN",
      "Retailer Class",
      "Outlet Source",
      "Approved Date",
      "Created Date",
      "Updated Date",
      "Status",
      
    ];

    const csvStream = format({
      headers,
      writeHeaders: true,
      quoteColumns: true,
    });

    csvStream.pipe(res);

    /* ----------------------------------------
       CURSOR
    ---------------------------------------- */
    const cursor = OutletApproved.find(query)
      .populate("zoneId", "name")
      .populate("stateId", "name")
      .populate("district", "name")
      .populate("employeeId", "name")
      .populate({
        path: "beatId",
        select: "name code regionId distributorId employeeId",
        populate: [
          { path: "regionId", select: "name" },
          { path: "distributorId", select: "name dbCode" },
          { path: "employeeId", select: "name" },
        ],
      })

      .lean()
      .batchSize(1000)
      .cursor();

    /* ----------------------------------------
       WRITE CSV ROWS
    ---------------------------------------- */
    for await (const outlet of cursor) {
      csvStream.write({
        "Outlet UID": outlet.outletUID || "",
        "Outlet Code": outlet.outletCode || "",
        "Outlet Name": outlet.outletName || "",
        "Source Ids": resolveSourceIds(outlet.massistRefIds),
        "Merged Points": outlet.mergedPoints || "",
        "Wallet Balance": outlet.currentPointBalance || 0,
        "Owner Name": outlet.ownerName || "",
        "Mobile Number": outlet.mobile1 || "",
        "Alternate Number": outlet.mobile2 || "",
        "WhatsApp Number": outlet.whatsappNumber || "",
        "Email": outlet.email || "",
        "Zone": outlet.zoneId?.name || "",
        "Region": resolveRegionName(outlet),
        "State": outlet.stateId?.name || "",
        "District": outlet.district?.name || "",
        "Beat": resolveBeatCodes(outlet.beatId),
        "Distributor": resolveDistributorName(outlet),
        "Distributor Code": resolveDistributorCode(outlet),
        "Employee": resolveEmployeeName(outlet),
        "Address": outlet.address1 || "",
        "Pincode": outlet.pin || "",
        "Shipping Address": outlet.shipToAddress || "",
        "Shipping Pincode": outlet.shipToPincode || "",
        "City": outlet.city || "",
        "Aadhar Number": outlet.aadharNumber || "",
        "PAN Number": outlet.panNumber || "",
        "GSTIN": outlet.gstin || "",
        "Retailer Class": outlet.retailerClass || "",
        "Outlet Source": outlet.outletSource || "",
        "Approved Date": formatDate(outlet.approvedDate),
        "Created Date": formatDate(outlet.createdAt),
        "Updated Date": formatDate(outlet.updatedAt),
        "Status": outlet.status ? "Active" : "Inactive",
      });

    }

    csvStream.end();
  } catch (error) {
    console.error("CSV EXPORT ERROR:", error);
    res.status(400);
    throw error;
  }
});

module.exports = {
  outletApprovedReport,
};
