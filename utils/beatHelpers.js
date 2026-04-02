const Beat = require("../models/beat.model");

/**
 * Add a distributor to a beat
 * @param {string} beatId - The beat ID
 * @param {string} distributorId - The distributor ID to add
 * @returns {Promise<Object>} Updated beat document
 */
const addDistributorToBeat = async (beatId, distributorId) => {
  return await Beat.findByIdAndUpdate(
    beatId,
    { $addToSet: { distributorId: distributorId } },
    { new: true }
  );
};

/**
 * Remove a distributor from a beat
 * @param {string} beatId - The beat ID
 * @param {string} distributorId - The distributor ID to remove
 * @returns {Promise<Object>} Updated beat document
 */
const removeDistributorFromBeat = async (beatId, distributorId) => {
  return await Beat.findByIdAndUpdate(
    beatId,
    { $pull: { distributorId: distributorId } },
    { new: true }
  );
};

/**
 * Find beats by distributor ID
 * @param {string} distributorId - The distributor ID
 * @param {Object} additionalFilters - Additional filters for the query
 * @returns {Promise<Array>} Array of beat documents
 */
const findBeatsByDistributor = async (
  distributorId,
  additionalFilters = {}
) => {
  return await Beat.find({
    distributorId: { $in: [distributorId] },
    ...additionalFilters,
  });
};

/**
 * Check if a beat has a specific distributor
 * @param {string} beatId - The beat ID
 * @param {string} distributorId - The distributor ID
 * @returns {Promise<boolean>} True if beat has the distributor
 */
const beatHasDistributor = async (beatId, distributorId) => {
  const beat = await Beat.findById(beatId);
  return (
    beat && beat.distributorId && beat.distributorId.includes(distributorId)
  );
};

/**
 * Get all distributors for a beat
 * @param {string} beatId - The beat ID
 * @returns {Promise<Array>} Array of distributor IDs
 */
const getBeatDistributors = async (beatId) => {
  const beat = await Beat.findById(beatId).select("distributorId");
  return beat ? beat.distributorId || [] : [];
};

module.exports = {
  addDistributorToBeat,
  removeDistributorFromBeat,
  findBeatsByDistributor,
  beatHasDistributor,
  getBeatDistributors,
};
