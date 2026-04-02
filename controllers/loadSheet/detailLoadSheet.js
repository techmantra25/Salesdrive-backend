const asyncHandler = require("express-async-handler");
const LoadSheet = require("../../models/loadSheet.model");

const detailLoadSheet = asyncHandler(async (req, res) => {
  try {
    const loadSheetData = await LoadSheet.findOne({
      _id: req.params.lid,
    }).populate([
      {
        path: "billIds",
        select: "",
        populate: {
          path: "lineItems.product",
          select: "",
        },
      },
      {
        path: "vehicleId",
        select: "",
      },
      {
        path: "deliveryBoyId",
        select: "",
      },
      {
        path: "beatId",
        select: "",
      },
      {
        path: "retailerId",
        select: "",
      },
    ]);
    if (!loadSheetData) {
      res.status(404);
      throw new Error("LoadSheet not found");
    }

    return res.status(200).json({
      status: 200,
      message: "LoadSheet retrieved successfully",
      data: loadSheetData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailLoadSheet };
