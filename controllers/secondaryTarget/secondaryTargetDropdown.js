const asyncHandler = require("express-async-handler");
const SecondaryTarget = require("../../models/secondaryTarget.model");

const secondaryTargetDropdown = asyncHandler(async (req, res) => {
  try {
    // query
    const { slab_type, distributorId, search } = req.query;

    const filter = {};

    if (distributorId) {
      filter.distributorId;
    }

    // if slab type is volume or value then only the for them we can expect there respected target only
    if (slab_type === "value" || slab_type === "volume") {
      filter.target_type = slab_type;
    }

    // if slab type is percentage then we can get both type of the targets
    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    // Query

    const targets = await SecondaryTarget.find(filter)
      .populate({ path: "distributorId", select: "name dbCode" })
      .populate({
        path: "retailerId",
        select: "outletName outletName outletUID",
      })
      .select("name target_type distributorId retailerId")
      .limit(100)
      .lean();

    //   format the data
    const formattedData = targets.map((t) => ({
      _id: t._id,
      name: t.name,
      target_type: t.target_type,
      distributorName: t.distributorId?.name || "N/A",
      distributorCode: t.distributorId?.dbCode || "N/A",
      retailerName: t.retailerId?.outletName || "N/A",
      retailerUID: t.retailerId?.outletUID || "N/A",
    }));

    return res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500);
    throw new Error(
      error?.message || "Failed to fetch the secondary target for dropdown",
    );
  }
});

module.exports = { secondaryTargetDropdown };
