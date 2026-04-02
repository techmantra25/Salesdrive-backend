const asyncHandler = require("express-async-handler");
const Distributor = require("../../models/distributor.model");
const PrimaryTarget = require("../../models/primaryTarget.model");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Zone = require("../../models/zone.model");
const Invoice = require("../../models/invoice.model");
const notificationQueue = require("../../queues/notificationQueue");

/* ----------------------------------------
   UPDATE PRIMARY TARGET  (PATCH)
---------------------------------------- */
const updatePrimaryTarget = asyncHandler(async (req, res) => {
  try {
    // UI → BACKEND FIELD MAPPING (KEEP)
    const target =
      req.body.target_type === "value"
        ? Number(req.body.targetValue)
        : Number(req.body.targetVolume);

    const start = new Date(req.body.target_start_date);
    const end = new Date(req.body.target_end_date);
    const target_month = start.getMonth() + 1;
    const target_year = start.getFullYear();

    const {
      distributorId,
      name,
      target_type,
      regionId,
      zoneId,
      stateId,
      approval_status,
    } = req.body;

    const primaryTarget = await PrimaryTarget.findById(req.params.id);

    if (!primaryTarget) {
      res.status(404);
      throw new Error("Primary target not found");
    }

    // ----------------- VALIDATIONS (UNCHANGED) -----------------

    if (distributorId) {
      const distributorExist = await Distributor.findOne({ _id: distributorId });
      if (!distributorExist) {
        res.status(400);
        throw new Error("Distributor not exists");
      }
    }

    if (!["volume", "value"].includes(target_type)) {
      res.status(404);
      throw new Error("Invalid target type, must be 'volume' or 'value'");
    }

    if (typeof target !== "number" || target <= 0) {
      res.status(404);
      throw new Error("Target must be a number");
    }

    if (!start || !end || start >= end) {
      res.status(400);
      throw new Error("Target start date must be before target end date");
    }

    if (typeof target_month !== "number" || target_month < 1 || target_month > 12) {
      res.status(404);
      throw new Error("Target month must be a number between 1 and 12");
    }

    if (stateId) {
      const stateExist = await State.findOne({ _id: stateId });
      if (!stateExist) {
        res.status(400);
        throw new Error("State not exists");
      }
    }

    if (stateId && regionId) {
      const regionExist = await Region.findOne({
        _id: regionId,
        stateId: stateId,
      });
      if (!regionExist) {
        res.status(400);
        throw new Error("Region not exists");
      }
    }

    if (zoneId) {
      const zoneExist = await Zone.findOne({ _id: zoneId });
      if (!zoneExist) {
        res.status(400);
        throw new Error("Zone not exists");
      }
    }

    // ----------------- UPDATE TARGET -----------------

    const updatedPrimaryTarget = await PrimaryTarget.findOneAndUpdate(
      { _id: req.params.id },
      {
        distributorId,
        name,
        target_type,
        targetValue: target_type === "value" ? target : null,
        targetVolume: target_type === "volume" ? target : null,
        target_month,
        target_year,
        regionId,
        zoneId,
        stateId,
        approval_status,
        target_start_date: start,
        target_end_date: end,
        updated_by: req.user._id,
      },
      { new: true }
    );

    if (!updatedPrimaryTarget) {
      res.status(500);
      throw new Error("Primary target not updated");
    }

    /* ==========================================================
       🔥 ADDED: RESYNC ACHIEVEMENT FROM CONFIRMED INVOICES
    ========================================================== */

    let achievement = 0;

    const confirmedBills = await Invoice.find({
      distributorId: updatedPrimaryTarget.distributorId,
      status: "Confirmed",
      grnDate: { $gte: start, $lte: end },
    });

    for (const bill of confirmedBills) {
      // VALUE TARGET
      if (updatedPrimaryTarget.target_type === "value") {
        achievement += Number(
          bill.totalBillValue ??
          bill.totalInvoiceAmount ??
          0
        );
      }

      // VOLUME TARGET
      if (updatedPrimaryTarget.target_type === "volume") {
        for (const item of bill.lineItems || []) {
          achievement += Number(item.receivedQty || 0);
        }
      }
    }

    await PrimaryTarget.findByIdAndUpdate(
      updatedPrimaryTarget._id,
      { achivedTarget: achievement }
    );

    /* ================= END RESYNC ================= */

    // 🔔 Send notification to distributor about target update
    const targetDetails = updatedPrimaryTarget.target_type === "value" 
      ? `Target Value: ₹${updatedPrimaryTarget.targetValue?.toLocaleString("en-IN")}`
      : `Target Volume: ${updatedPrimaryTarget.targetVolume?.toLocaleString("en-IN")} units`;
    
    const message = `Your target "${updatedPrimaryTarget.name}" has been updated. ${targetDetails}`;
    
    await notificationQueue.add("primaryTargetUpdate", {
      type: "Target",
      data: {
        message,
        title: "Primary Target Updated",
        targetId: updatedPrimaryTarget._id,
        targetName: updatedPrimaryTarget.name,
        targetType: updatedPrimaryTarget.target_type,
        targetValue: updatedPrimaryTarget.target_type === "value" ? updatedPrimaryTarget.targetValue : null,
        targetVolume: updatedPrimaryTarget.target_type === "volume" ? updatedPrimaryTarget.targetVolume : null,
        startDate: updatedPrimaryTarget.target_start_date,
        endDate: updatedPrimaryTarget.target_end_date,
      },
      userId: updatedPrimaryTarget.distributorId,
      userType: "Distributor",
    });

    return res.status(201).json({
      status: 201,
      message: "Primary target updated successfully",
      data: {
        ...updatedPrimaryTarget.toObject(),
        achivedTarget: achievement,
      },
    });

  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

/* ----------------------------------------
   DELETE PRIMARY TARGET  (DELETE)
---------------------------------------- */
const deletePrimaryTarget = asyncHandler(async (req, res) => {
  const primaryTarget = await PrimaryTarget.findById(req.params.id);

  if (!primaryTarget) {
    return res.status(404).json({ message: "Primary target not found" });
  }

 
  await PrimaryTarget.findByIdAndUpdate(req.params.id, {
    isActive: false,
    updated_by: req.user?._id,
  });

  res.status(200).json({
    message: "Primary target deactivated successfully",
  });
});

module.exports = { updatePrimaryTarget, deletePrimaryTarget };
