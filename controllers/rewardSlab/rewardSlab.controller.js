const asyncHandler = require("express-async-handler");
const RewardSlab = require("../../models/rewardSlab.model");
const { getDefaultSlabs } = require("./util/getDefaultSlabs");

const getRewardSlabs = asyncHandler(async (req, res) => {
  try {
    let rewardSlabs = await RewardSlab.find({});

    // If no reward slabs exist, create default ones
    if (!rewardSlabs || rewardSlabs.length === 0) {
      const defaultSlabs = getDefaultSlabs();
      rewardSlabs = await RewardSlab.insertMany(defaultSlabs);
    }

    res.status(200).json({
      status: 200,
      error: false,
      message: "Reward slabs fetched successfully",
      data: rewardSlabs,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

const updateRewardSlabs = asyncHandler(async (req, res) => {
  try {
    const { slabType, description, slabs, status } = req.body;

    // Validate required fields
    if (!slabType || !slabs || !Array.isArray(slabs)) {
      res.status(400);
      throw new Error("slabType and slabs array are required");
    }

    // Find and update the reward slab by slabType
    const updatedRewardSlab = await RewardSlab.findOneAndUpdate(
      { slabType },
      { slabType, description, slabs, status },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      status: 200,
      error: false,
      message: "Reward slab updated successfully",
      data: updatedRewardSlab,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { getRewardSlabs, updateRewardSlabs };
