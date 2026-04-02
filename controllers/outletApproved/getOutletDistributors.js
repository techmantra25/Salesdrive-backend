const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");

const getOutletDistributors = asyncHandler(async (req, res) => {
  try {
    const { outletId } = req.params;

    const outlet = await OutletApproved.findById(outletId)
      .select("beatId")
      .lean();

    if (!outlet || !outlet.beatId) {
      return res.json({ success: true, distributors: [] });
    }

    const beatIds = Array.isArray(outlet.beatId)
      ? outlet.beatId
      : [outlet.beatId];

    const beats = await Beat.find({ _id: { $in: beatIds } })
      .select("distributorId")
      .lean();

    const distributorIds = [
      ...new Set(
        beats.flatMap((b) => b.distributorId || []).map((id) => id.toString())
      ),
    ];

    if (distributorIds.length === 0) {
      return res.json({ success: true, distributors: [] });
    }

    const distributors = await require("../../models/distributor.model")
      .find({ _id: { $in: distributorIds } })
      .select("name dbCode")
      .lean();

    return res.json({
      success: true,
      distributors,
    });
  } catch (error) {
    console.error("GET OUTLET DISTRIBUTOR ERROR:", error);
    res.status(400);
    throw error;
  }
});

module.exports = { getOutletDistributors };