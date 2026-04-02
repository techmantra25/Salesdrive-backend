const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");

const disDashCount = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;
    const goDown = req.user.goDown;

    let inventoryCount = {};

    for (const goDownType of goDown) {
      inventoryCount[goDownType] = await Inventory.countDocuments({
        distributorId,
        godownType: goDownType,
      });
    }

    return res.status(200).json({
      status: 200,
      message: "All data count",
      data: {
        inventoryCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { disDashCount };
