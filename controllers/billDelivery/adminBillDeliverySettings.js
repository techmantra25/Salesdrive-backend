const asyncHandler = require("express-async-handler");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const Distributor = require("../../models/distributor.model");

const parseIsActive = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }

  return true;
};

const hasDurationValue = (value) =>
  value !== undefined && value !== null && value !== "";

const isInvalidDeliveryDuration = (value) =>
  Number.isNaN(value) || value < 1 || value > 30;

const setBillDeliverySetting = asyncHandler(async (req, res) => {
  const {
    distributorId,
    deliveryDurationDays,
    notes,
    isActive,
    enableBackdateBilling,
  } = req.body;
  const isActiveFlag = parseIsActive(isActive);
  const enableBackdateBillingFlag = parseIsActive(enableBackdateBilling);
  const shouldUpdateDuration = hasDurationValue(deliveryDurationDays);
  const normalizedDeliveryDuration = shouldUpdateDuration
    ? Number(deliveryDurationDays)
    : undefined;

  // Validation
  if (!distributorId) {
    return res.status(400).json({
      error: true,
      message: "Distributor ID is required",
    });
  }

  // Check if distributor exists
  const distributor = await Distributor.findById(distributorId);
  if (!distributor) {
    return res.status(404).json({
      error: true,
      message: "Distributor not found",
    });
  }

  // Check if setting already exists
  let setting = await BillDeliverySetting.findOne({ distributorId });
  const effectiveIsActive =
    isActiveFlag !== undefined ? isActiveFlag : (setting?.isActive ?? true);

  if (
    effectiveIsActive &&
    shouldUpdateDuration &&
    isInvalidDeliveryDuration(normalizedDeliveryDuration)
  ) {
    return res.status(400).json({
      error: true,
      message: "Delivery duration must be between 1 and 30 days",
    });
  }

  if (setting) {
    // Update existing setting
    if (shouldUpdateDuration && effectiveIsActive) {
      setting.deliveryDurationDays = normalizedDeliveryDuration;
    }
    if (isActiveFlag !== undefined) {
      setting.isActive = isActiveFlag;
    }
    if (enableBackdateBillingFlag !== undefined) {
      setting.enableBackdateBilling = enableBackdateBillingFlag;
    }
    setting.notes = notes !== undefined ? notes : setting.notes;
    setting.updatedBy = req.user._id; // Admin user ID
    await setting.save();

    if (effectiveIsActive === false) {
      await Distributor.updateOne(
        { _id: distributorId },
        {
          $set: {
            isPortalLocked: false,
            portalLockReason: "Bill delivery configuration is disabled",
            portalLockedAt: null,
            portalLockedBy: null,
            pendingBillDeliveries: [],
          },
        },
      );
    }

    return res.status(200).json({
      error: false,
      message: "Bill delivery setting updated successfully",
      data: setting,
    });
  } else {
    // Create new setting
    const newSetting = {
      distributorId,
      notes: notes || "",
      createdBy: req.user._id, // Admin user ID
    };

    if (isActiveFlag !== undefined) {
      newSetting.isActive = isActiveFlag;
    }

    if (enableBackdateBillingFlag !== undefined) {
      newSetting.enableBackdateBilling = enableBackdateBillingFlag;
    }

    if (shouldUpdateDuration && effectiveIsActive) {
      newSetting.deliveryDurationDays = normalizedDeliveryDuration;
    }

    setting = await BillDeliverySetting.create(newSetting);

    if (effectiveIsActive === false) {
      await Distributor.updateOne(
        { _id: distributorId },
        {
          $set: {
            isPortalLocked: false,
            portalLockReason: "Bill delivery configuration is disabled",
            portalLockedAt: null,
            portalLockedBy: null,
            pendingBillDeliveries: [],
          },
        },
      );
    }

    return res.status(201).json({
      error: false,
      message: "Bill delivery setting created successfully",
      data: setting,
    });
  }
});

const getBillDeliverySetting = asyncHandler(async (req, res) => {
  const { distributorId } = req.params;

  const setting = await BillDeliverySetting.findOne({ distributorId })
    .populate("distributorId", "name dbCode email")
    .populate("createdBy", "name email")
    .populate("updatedBy", "name email");

  if (!setting) {
    return res.status(404).json({
      error: true,
      message: "Bill delivery setting not found for this distributor",
    });
  }

  res.status(200).json({
    error: false,
    data: setting,
  });
});

const getAllBillDeliverySettings = asyncHandler(async (req, res) => {
  const settings = await BillDeliverySetting.find()
    .populate("distributorId", "name dbCode email isPortalLocked")
    .populate("createdBy", "name email")
    .populate("updatedBy", "name email")
    .sort({ createdAt: -1 });

  res.status(200).json({
    error: false,
    count: settings.length,
    data: settings,
  });
});

const setBillDeliverySettingForAll = asyncHandler(async (req, res) => {
  const { deliveryDurationDays, notes, isActive, enableBackdateBilling } =
    req.body;
  const isActiveFlag = parseIsActive(isActive);
  const enableBackdateBillingFlag = parseIsActive(enableBackdateBilling);
  const shouldUpdateDuration = hasDurationValue(deliveryDurationDays);
  const normalizedDeliveryDuration = shouldUpdateDuration
    ? Number(deliveryDurationDays)
    : undefined;

  if (
    shouldUpdateDuration &&
    isInvalidDeliveryDuration(normalizedDeliveryDuration)
  ) {
    return res.status(400).json({
      error: true,
      message: "Delivery duration must be between 1 and 30 days",
    });
  }

  const distributors = await Distributor.find({}).select("_id");
  if (!distributors.length) {
    return res.status(200).json({
      error: false,
      message: "No distributors found",
      data: {
        total: 0,
        configured: 0,
      },
    });
  }

  const now = new Date();
  const bulkOps = distributors.map((distributor) => {
    const setFields = {
      updatedBy: req.user._id,
    };
    const setOnInsertFields = {
      createdBy: req.user._id,
      createdAt: now,
    };

    if (notes !== undefined) {
      setFields.notes = notes;
    } else {
      setOnInsertFields.notes = "";
    }

    if (isActiveFlag !== undefined) {
      setFields.isActive = isActiveFlag;
    } else {
      setOnInsertFields.isActive = true;
    }

    if (enableBackdateBillingFlag !== undefined) {
      setFields.enableBackdateBilling = enableBackdateBillingFlag;
    } else {
      setOnInsertFields.enableBackdateBilling = false;
    }

    if (shouldUpdateDuration) {
      setFields.deliveryDurationDays = normalizedDeliveryDuration;
    } else if ((isActiveFlag ?? true) === true) {
      setOnInsertFields.deliveryDurationDays = 7;
    }

    return {
      updateOne: {
        filter: { distributorId: distributor._id },
        update: {
          $set: setFields,
          $setOnInsert: setOnInsertFields,
          $currentDate: {
            updatedAt: true,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await BillDeliverySetting.bulkWrite(bulkOps, {
    ordered: false,
  });

  const configuredCount =
    (result?.matchedCount || 0) +
    (result?.upsertedCount || 0) +
    (result?.modifiedCount || 0);

  if (isActiveFlag === false) {
    await Distributor.updateMany(
      { _id: { $in: distributors.map((distributor) => distributor._id) } },
      {
        $set: {
          isPortalLocked: false,
          portalLockReason: "Bill delivery configuration is disabled",
          portalLockedAt: null,
          portalLockedBy: null,
          pendingBillDeliveries: [],
        },
      },
    );
  }

  res.status(200).json({
    error: false,
    message: "Bill delivery settings applied to all distributors",
    data: {
      total: distributors.length,
      configured: configuredCount,
      matched: result?.matchedCount || 0,
      modified: result?.modifiedCount || 0,
      upserted: result?.upsertedCount || 0,
    },
  });
});

const deleteBillDeliverySetting = asyncHandler(async (req, res) => {
  const { distributorId } = req.params;

  const setting = await BillDeliverySetting.findOneAndDelete({ distributorId });

  if (!setting) {
    return res.status(404).json({
      error: true,
      message: "Bill delivery setting not found",
    });
  }

  res.status(200).json({
    error: false,
    message: "Bill delivery setting deleted successfully",
  });
});

const unlockDistributorPortal = asyncHandler(async (req, res) => {
  const { distributorId, reason } = req.body;

  if (!distributorId) {
    return res.status(400).json({
      error: true,
      message: "Distributor ID is required",
    });
  }

  const distributor = await Distributor.findById(distributorId);
  if (!distributor) {
    return res.status(404).json({
      error: true,
      message: "Distributor not found",
    });
  }

  // Unlock portal
  distributor.isPortalLocked = false;
  distributor.portalLockReason = `Manually unlocked by admin. ${reason || ""}`;
  distributor.portalLockedAt = null;
  distributor.portalLockedBy = null;
  distributor.pendingBillDeliveries = [];
  await distributor.save();

  res.status(200).json({
    error: false,
    message: "Distributor portal unlocked successfully",
    data: {
      distributorId: distributor._id,
      name: distributor.name,
      isPortalLocked: distributor.isPortalLocked,
    },
  });
});

const getLockedDistributors = asyncHandler(async (req, res) => {
  const lockedDistributors = await Distributor.find({ isPortalLocked: true })
    .select(
      "name dbCode email isPortalLocked portalLockReason portalLockedAt portalLockedBy pendingBillDeliveries",
    )
    .populate(
      "pendingBillDeliveries.billId",
      "billNo invoiceAmount status dates",
    )
    .sort({ portalLockedAt: -1 });

  res.status(200).json({
    error: false,
    count: lockedDistributors.length,
    data: lockedDistributors,
  });
});

module.exports = {
  setBillDeliverySetting,
  getBillDeliverySetting,
  getAllBillDeliverySettings,
  setBillDeliverySettingForAll,
  deleteBillDeliverySetting,
  unlockDistributorPortal,
  getLockedDistributors,
};
