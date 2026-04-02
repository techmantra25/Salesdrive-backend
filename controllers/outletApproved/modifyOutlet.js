const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const OutletApprovedSource = require("../../models/outletApprovedSource.model");
const mongoose = require("mongoose");
const {
  generateUniversalOutletUID,
} = require("../../utils/codeGenerator");

// ✓ Handle SourceData
const handleSourceData = async (existingOutlet) => {
  // CASE 1 → Already ObjectId → return as is
  if (mongoose.isValidObjectId(existingOutlet.sourceData)) {
    console.log("sourceData is already ObjectId → no change");
    return existingOutlet.sourceData;
  }

  // CASE 2 → Exists but plain object → save it
  if (existingOutlet.sourceData && typeof existingOutlet.sourceData === "object") {
    console.log("sourceData is plain object → creating new OutletApprovedSource");

    const sourceDoc = await OutletApprovedSource.create({
      sourceData: [existingOutlet.sourceData],
    });

    return sourceDoc._id;
  }

  // CASE 3 → Does NOT exist → create new empty sourceDoc with nothing
  console.log("sourceData missing → creating new empty sourceData doc");
  const sourceDoc = await OutletApprovedSource.create({
    sourceData: [existingOutlet],
  });

  return sourceDoc._id;
};

// -------------------------------------------------------------

const modifyOutletByCode = asyncHandler(async (req, res) => {
  console.log("Modifying outlet codes and UIDs…");

  try {
    const { outletCode, outletUID } = req.body;

    if (!outletCode && !outletUID) {
      return res.status(400).json({
        error: true,
        message: "Either outletCode or outletUID is required",
      });
    }

    let query = { status: true };

    if (outletCode && outletUID) {
      query.$or = [{ outletCode }, { outletUID }];
    } else if (outletCode) {
      query.outletCode = outletCode;
    } else {
      query.outletUID = outletUID;
    }

    const existingOutlet = await OutletApproved.findOne(query).lean();

    if (!existingOutlet) {
      return res.status(404).json({
        error: true,
        message: "No outlet found with given code/UID",
      });
    }

    const isFirstUpdate = !existingOutlet.isUpdatedOutletCode;

    let newOutletCode;
    let newOutletUID = await generateUniversalOutletUID();

    if (isFirstUpdate) {
      newOutletCode = existingOutlet.outletUID;

      // Validate generated new codes
      const codeExists = await OutletApproved.findOne({
        outletCode: newOutletCode,
        _id: { $ne: existingOutlet._id },
      });

      const uidExists = await OutletApproved.findOne({
        outletUID: newOutletUID,
        _id: { $ne: existingOutlet._id },
      });

      if (codeExists || uidExists) {
        return res.status(400).json({
          error: true,
          message: "Generated codes already exist. Retry.",
        });
      }
    } else {
      // Only check UID for duplicate
      const uidExists = await OutletApproved.findOne({
        outletUID: newOutletUID,
        _id: { $ne: existingOutlet._id },
      });

      if (uidExists) {
        return res.status(400).json({
          error: true,
          message: "Generated UID already exists. Retry.",
        });
      }
    }

    // ------------------------------
    // Handle SourceData here
    // ------------------------------
    const finalSourceId = await handleSourceData(existingOutlet);

    // ------------------------------
    // Prepare Update Payload
    // ------------------------------
    const updateData = {
      outletUID: newOutletUID,
      sourceData: finalSourceId,
    };

    if (isFirstUpdate) {
      updateData.outletCode = newOutletCode;
      updateData.isUpdatedOutletCode = true;
      updateData.$addToSet = { massistRefIds: newOutletCode };
    }

    const updatedOutlet = await OutletApproved.findByIdAndUpdate(
      existingOutlet._id,
      updateData,
      { new: true, runValidators: true }
    );

    const response = {
      outletId: existingOutlet._id,
      oldOutletCode: existingOutlet.outletCode,
      newOutletCode: isFirstUpdate ? newOutletCode : existingOutlet.outletCode,
      oldOutletUID: existingOutlet.outletUID,
      newOutletUID,
      outletName: updatedOutlet.outletName,
      isUpdatedOutletCode: updatedOutlet.isUpdatedOutletCode,
      updateType: isFirstUpdate ? "firstUpdate" : "subsequentUpdate",
    };

    res.status(200).json({
      error: false,
      message: isFirstUpdate
        ? "OutletCode & UID updated successfully"
        : "Outlet UID updated successfully",
      data: response,
    });
  } catch (error) {
    console.error("modifyOutletByCode error", error);
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

module.exports = { modifyOutletByCode };
