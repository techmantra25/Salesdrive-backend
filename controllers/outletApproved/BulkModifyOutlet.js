const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const OutletApprovedSource = require("../../models/outletApprovedSource.model");
const mongoose = require("mongoose");
const { generateUniversalOutletUID } = require("../../utils/codeGenerator");

// BATCH SIZE
const BATCH_SIZE = 500;

// SAME LOGIC AS SINGLE CONTROLLER
const handleSourceData = async (outlet) => {
  if (mongoose.isValidObjectId(outlet.sourceData)) {
    return outlet.sourceData; // already ObjectId
  }

  // CASE 2 → plain object inside
  if (outlet.sourceData && typeof outlet.sourceData === "object") {
    const doc = await OutletApprovedSource.create({
      sourceData: [outlet.sourceData],
    });
    return doc._id;
  }

  // CASE 3 → no sourceData → SAVE FULL OUTLET
  const doc = await OutletApprovedSource.create({
    sourceData: [outlet],
  });

  return doc._id;
};

const migrateAllOutletsFast = asyncHandler(async (req, res) => {
  console.log("🚀 STARTING FAST BULK MIGRATION...");

  const cursor = OutletApproved.find({
    status: true,
    massistRefIds:{$exists:false}                              //check massistRefIds empty or not
    
  }).cursor();

  console.log("cursor",cursor);

  let batch = [];
  let success = 0;
  let failed = [];

  for (
    let existingOutlet = await cursor.next();
    existingOutlet != null;
    existingOutlet = await cursor.next()
  ) {
    try {
      const isFirstUpdate = !existingOutlet.isUpdatedOutletCode;

      let newUID = await generateUniversalOutletUID();

      // Validate no duplicate UID
      const uidExists = await OutletApproved.findOne({
        outletUID: newUID,
        _id: { $ne: existingOutlet._id },
      });

      if (uidExists) {
        failed.push({
          outletId: existingOutlet._id,
          reason: "Duplicate UID generated",
        });
        continue;
      }

      let newCode = existingOutlet.outletCode;

      if (isFirstUpdate) {
        newCode = existingOutlet.outletUID;

        const codeExists = await OutletApproved.findOne({
          outletCode: newCode,
          _id: { $ne: existingOutlet._id },
        });

        if (codeExists) {
          failed.push({
            outletId: existingOutlet._id,
            reason: "Duplicate Code generated",
          });
          continue;
        }
      }

      // FIX SOURCE DATA
      const finalSourceId = await handleSourceData(existingOutlet);

      // BULK UPDATE OBJECT (IMPORTANT PART)
      let updateObj = {
        updateOne: {
          filter: { _id: existingOutlet._id },
          update: {
            $set: {
              outletUID: newUID,
              sourceData: finalSourceId,
            },
          },
        },
      };

      if (isFirstUpdate) {
        updateObj.updateOne.update.$set.outletCode = newCode;
        updateObj.updateOne.update.$set.isUpdatedOutletCode = true;

        // THIS FIXES massistRefIds NOT SAVING
        updateObj.updateOne.update.$addToSet = {
          massistRefIds: newCode,
        };
      }

      batch.push(updateObj);
      success++;

      // When batch full → flush to DB
      if (batch.length >= BATCH_SIZE) {
        await OutletApproved.bulkWrite(batch);
        console.log(`✔ Processed batch of ${batch.length}`);
        batch = [];
      }
    } catch (err) {
      failed.push({ outletId: existingOutlet._id, reason: err.message });
    }
  }

  // Final flush
  if (batch.length) {
    await OutletApproved.bulkWrite(batch);
  }

  return res.status(200).json({
    error: false,
    message: "🚀 FAST BULK MIGRATION COMPLETED",
    summary: {
      success,
      failed: failed.length,
    },
    failed,
  });
});

module.exports = { migrateAllOutletsFast };
