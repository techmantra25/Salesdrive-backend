const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");
const {
  addDistributorToBeat,
  removeDistributorFromBeat,
} = require("../../utils/beatHelpers");

const updateBeatDistributors = asyncHandler(async (req, res) => {
  try {
    const { beatId } = req.params;
    const { action, distributorId } = req.body; // action: 'add' or 'remove'

    if (!["add", "remove"].includes(action)) {
      res.status(400);
      throw new Error("Action must be either 'add' or 'remove'");
    }

    if (!distributorId) {
      res.status(400);
      throw new Error("distributorId is required");
    }

    let updatedBeat;

    if (action === "add") {
      updatedBeat = await addDistributorToBeat(beatId, distributorId);
    } else {
      updatedBeat = await removeDistributorFromBeat(beatId, distributorId);
    }

    if (!updatedBeat) {
      res.status(404);
      throw new Error("Beat not found");
    }

    return res.status(200).json({
      status: 200,
      message: `Distributor ${
        action === "add" ? "added to" : "removed from"
      } beat successfully`,
      data: updatedBeat,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { updateBeatDistributors };
