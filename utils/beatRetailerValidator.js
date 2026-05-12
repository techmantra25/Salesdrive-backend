const Beat = require("../models/beat.model");

/**
 * Validates if an outlet can be assigned to a beat based on creation dates
 * Rule: Outlet must be created on or after the beat's creation date (only for manually created beats)
 * For file upload created beats, no date restriction is applied
 *
 * @param {ObjectId} beatId - The beat ID
 * @param {Date} outletCreatedAt - The outlet's creation date
 * @returns {Promise<Object>} { isValid: boolean, message: string }
 */
const validateOutletBeatAssignment = async (beatId, outletCreatedAt) => {
  try {
    const beat = await Beat.findById(beatId).select("createdAt name code createdVia");

    if (!beat) {
      return {
        isValid: false,
        message: `Beat not found with ID: ${beatId}`,
      };
    }

    // Skip date validation for beats created via file upload
    if (beat.createdVia === "fileUpload") {
      return {
        isValid: true,
        message: `Outlet is valid for assignment to beat ${beat.name} (file upload beat - no date restriction)`,
        beatCreatedAt: beat.createdAt,
      };
    }

    // Apply date validation only for manually created beats
    // Outlet must be created >= beat creation date
    if (outletCreatedAt < beat.createdAt) {
      return {
        isValid: false,
        message: `Outlet created on ${outletCreatedAt.toISOString()} is earlier than beat (${beat.name} - ${beat.code}) creation date ${beat.createdAt.toISOString()}. Only outlets created after beat creation can be assigned.`,
        beatCreatedAt: beat.createdAt,
        outletCreatedAt: outletCreatedAt,
      };
    }

    return {
      isValid: true,
      message: `Outlet is valid for assignment to beat ${beat.name}`,
      beatCreatedAt: beat.createdAt,
    };
  } catch (error) {
    return {
      isValid: false,
      message: `Error validating outlet-beat assignment: ${error.message}`,
    };
  }
};

/**
 * Validates multiple outlets against a beat's creation date
 * Only applies date validation for manually created beats
 *
 * @param {ObjectId} beatId - The beat ID
 * @param {Array<{_id: ObjectId, createdAt: Date} | Date>} outlets - Array of outlets or dates to validate
 * @returns {Promise<Object>} { valid: array, invalid: array }
 */
const validateMultipleOutletBeatAssignments = async (beatId, outlets) => {
  const beat = await Beat.findById(beatId).select("createdAt name code createdVia");

  if (!beat) {
    throw new Error(`Beat not found with ID: ${beatId}`);
  }

  const valid = [];
  const invalid = [];

  for (const outlet of outlets) {
    // Handle both outlet objects with createdAt and raw dates
    const outletCreatedAt = outlet.createdAt || outlet;

    // Skip date validation for file upload beats
    if (beat.createdVia === "fileUpload") {
      valid.push(outlet._id || outlet);
      continue;
    }

    // Apply date validation only for manually created beats
    if (outletCreatedAt < beat.createdAt) {
      invalid.push({
        outlet: outlet._id || outlet,
        reason: `Created on ${new Date(outletCreatedAt).toISOString()} before beat creation`,
        beatCreatedAt: beat.createdAt,
        outletCreatedAt: outletCreatedAt,
      });
    } else {
      valid.push(outlet._id || outlet);
    }
  }

  return { valid, invalid, beatCreatedAt: beat.createdAt };
};

/**
 * Filters outlets by beat creation date
 * Returns only outlets created on or after the beat's creation date
 * For file upload beats, returns all outlets without date filtering
 *
 * @param {ObjectId} beatId - The beat ID
 * @param {Array<ObjectId>} outletIds - Array of outlet IDs to filter
 * @param {Model} OutletModel - The Outlet model to query
 * @returns {Promise<Array>} Array of valid outlet IDs
 */
const filterOutletsByBeatCreationDate = async (
  beatId,
  outletIds,
  OutletModel,
) => {
  const beat = await Beat.findById(beatId).select("createdAt createdVia");

  if (!beat) {
    throw new Error(`Beat not found with ID: ${beatId}`);
  }

  // For file upload beats, return all outlets without filtering by date
  if (beat.createdVia === "fileUpload") {
    const allOutlets = await OutletModel.find({
      _id: { $in: outletIds },
    }).select("_id");
    return allOutlets.map((outlet) => outlet._id);
  }

  // For manually created beats, filter outlets by creation date
  const validOutlets = await OutletModel.find({
    _id: { $in: outletIds },
    createdAt: { $gte: beat.createdAt },
  }).select("_id");

  return validOutlets.map((outlet) => outlet._id);
};

module.exports = {
  validateOutletBeatAssignment,
  validateMultipleOutletBeatAssignments,
  filterOutletsByBeatCreationDate,
};
