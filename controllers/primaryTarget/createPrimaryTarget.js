const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const PrimaryTarget = require("../../models/primaryTarget.model");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Zone = require("../../models/zone.model");
const Invoice = require("../../models/invoice.model");
const notificationQueue = require("../../queues/notificationQueue");

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

// ================= CONTROLLER =================

const createPrimaryTarget = asyncHandler(async (req, res) => {
  const {
    distributorId,
    name,
    target_type,
    targetValue,
    targetVolume,
    brandId,
    subBrandId,
    target_start_date,
    target_end_date,
    regionId,
    zoneId,
    stateId,
  } = req.body;

  console.log("Received data for creating primary target:", req.body);

  // ---------------- BASIC VALIDATION ----------------

  if (!name || !distributorId || !target_type) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!["volume", "value"].includes(target_type)) {
    return res.status(400).json({ message: "Invalid target type" });
  }

  if (target_type === "value") {
    if (typeof targetValue !== "number" || targetValue <= 0) {
      return res.status(400).json({
        message: "targetValue must be a positive number",
      });
    }
  }

  if (target_type === "volume") {
    if (typeof targetVolume !== "number" || targetVolume <= 0) {
      return res.status(400).json({
        message: "targetVolume must be a positive number",
      });
    }
  }

  if (!target_start_date || !target_end_date) {
    return res.status(400).json({ message: "Target period is required" });
  }

  const start = new Date(target_start_date);
  const end = new Date(target_end_date);

  if (start >= end) {
    return res.status(400).json({
      message: "Target end date must be greater than target start date",
    });
  }

  // ---------------- DISTRIBUTOR CHECK ----------------

  const distributor = await Distributor.findById(distributorId);

  if (!distributor) {
    return res.status(400).json({ message: "Distributor not found" });
  }

  const targetUid = await generateTargetUid(distributor.dbCode);

  // ---------------- STATE / REGION / ZONE VALIDATION ----------------

  if (stateId) {
    const stateExist = await State.findById(stateId);
    if (!stateExist) {
      return res.status(400).json({ message: "State not found" });
    }
  }

  if (regionId) {
    const regionExist = await Region.findById(regionId);
    if (!regionExist) {
      return res.status(400).json({ message: "Region not found" });
    }
  }

  if (zoneId) {
    const zoneExist = await Zone.findById(zoneId);
    if (!zoneExist) {
      return res.status(400).json({ message: "Zone not found" });
    }
  }

  // ---------------- BRAND ARRAY ----------------

  let brandIds;

  if (!brandId || (Array.isArray(brandId) && brandId.length === 0)) {
    brandIds = [];
  } else if (Array.isArray(brandId)) {
    brandIds = brandId;
  } else {
    brandIds = [brandId];
  }

  // ---------------- SUBBRAND ARRAY ----------------

  let allSubBrandIds;

  if (!subBrandId || (Array.isArray(subBrandId) && subBrandId.length === 0)) {
    allSubBrandIds = [];
  } else if (Array.isArray(subBrandId)) {
    allSubBrandIds = subBrandId.map((id) => id.toString());
  } else {
    allSubBrandIds = [subBrandId.toString()];
  }

  const distributorBrandIds = distributor.brandId.map((id) =>
    id.toString()
  );

  for (const b of brandIds) {
    if (b && !distributorBrandIds.includes(b.toString())) {
      return res.status(400).json({
        message: "Brand is not mapped with this distributor",
        brandId: b,
      });
    }
  }

  // ---------------- OVERLAP CHECK ----------------

  const overlappingTarget = await PrimaryTarget.findOne({
    distributorId,
    isActive: true,
    ...(brandIds.length && { brandId: { $in: brandIds } }),
    ...(allSubBrandIds.length && { subBrandId: { $in: allSubBrandIds } }),
    $and: [
      { target_start_date: { $lte: end } },
      { target_end_date: { $gte: start } },
    ],
  });

  if (overlappingTarget) {
    return res.status(400).json({
      message:
        "Target already exists for this distributor and brand in selected date range",
    });
  }

  // ---------------- CREATE ----------------

  const primaryTarget = await PrimaryTarget.create({
    distributorId,
    name,
    targetUid,
    brandId: brandIds.length ? brandIds : null,
    subBrandId: allSubBrandIds,
    target_type,
    targetValue: target_type === "value" ? targetValue : null,
    targetVolume: target_type === "volume" ? targetVolume : null,
    target_start_date: start,
    target_end_date: end,
    regionId: regionId || null,
    zoneId: zoneId || null,
    stateId: stateId || null,
    created_by: req.user._id,
  });

  console.log("Created primary target:", primaryTarget);

  // ================= ACHIEVEMENT =================

  let achievement = 0;

  const confirmedBills = await Invoice.find({
    distributorId,
    status: "Confirmed",
    grnDate: { $gte: start, $lte: end },
  }).populate({
    path: "lineItems.product",
    select: "brand subBrand",
  });

  const billsUsedForTarget = new Set();

  for (const bill of confirmedBills) {
    for (const item of bill.lineItems || []) {
      const product = item.product;
      if (!product) continue;

      // ---------------- NO BRAND ----------------
      if (!brandIds.length) {
        if (target_type === "value") {
          achievement += Number(bill.totalInvoiceAmount || 0);
          billsUsedForTarget.add(bill._id.toString());
          break;
        }

        if (target_type === "volume") {
          achievement += Number(item.receivedQty || 0);
          billsUsedForTarget.add(bill._id.toString());
        }

        continue;
      }

      // ---------------- BRAND ONLY ----------------
      if (brandIds.length && allSubBrandIds.length === 0) {
        if (!product.brand) continue;

        if (!brandIds.includes(product.brand.toString())) continue;

        if (target_type === "value") {
          achievement += Number(item.netAmount || 0);
        }

        if (target_type === "volume") {
          achievement += Number(item.receivedQty || 0);
        }

        billsUsedForTarget.add(bill._id.toString());
        continue;
      }

      // ================= FIXED LOGIC =================
      if (brandIds.length && allSubBrandIds.length > 0) {
        if (!product.brand) continue;

        const productBrand = product.brand.toString();
        const productSubBrand = product.subBrand
          ? product.subBrand.toString()
          : null;

        const brandMatch = brandIds.includes(productBrand);
        if (!brandMatch) continue;

        //  Step 1: Check if THIS BRAND has any subBrand filter
        const hasSubBrandFilterForThisBrand =
          productSubBrand &&
          allSubBrandIds.includes(productSubBrand);

        //  Step 2: Detect if ANY subBrand from this brand exists in filter
        const isThisBrandFiltered = productSubBrand
          ? allSubBrandIds.includes(productSubBrand)
          : false;

        //  FINAL RULE:
        // If subBrand exists in filter → apply filter
        // Else → allow full brand (EU, JN case)

        if (allSubBrandIds.length > 0) {
          if (isThisBrandFiltered) {
            // apply strict filter
            if (!hasSubBrandFilterForThisBrand) continue;
          }
          // else → allow all (EU, JN)
        }

        if (target_type === "value") {
          achievement += Number(item.netAmount || 0);
        }

        if (target_type === "volume") {
          achievement += Number(item.receivedQty || 0);
        }

        billsUsedForTarget.add(bill._id.toString());
      }
    }
  }

  if (achievement > 0) {
    await PrimaryTarget.findByIdAndUpdate(primaryTarget._id, {
      $inc: { achivedTarget: achievement },
    });
  }

  if (billsUsedForTarget.size > 0) {
    await Invoice.updateMany(
      { _id: { $in: Array.from(billsUsedForTarget) } },
      {
        $addToSet: {
          targetIds: primaryTarget._id,
        },
      }
    );
  }

  // ---------------- NOTIFICATION ----------------

  const targetDetails =
    target_type === "value"
      ? `Target Value: ₹${targetValue.toLocaleString("en-IN")}`
      : `Target Volume: ${targetVolume.toLocaleString("en-IN")} units`;

  const message = `New ${target_type} target "${name}" has been assigned to you. ${targetDetails}`;

  await notificationQueue.add("primaryTarget", {
    type: "Target",
    data: {
      message,
      title: "New Primary Target Assigned",
      targetId: primaryTarget._id,
      targetName: name,
      targetType: target_type,
    },
    userId: distributorId,
    userType: "Distributor",
  });

  res.status(201).json({
    status: 201,
    message: "Primary Target created successfully",
    data: primaryTarget,
  });
});

module.exports = { createPrimaryTarget };