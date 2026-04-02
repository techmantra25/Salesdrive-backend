const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

// Get Order Entry Details by ID
const detailOrderEntry = asyncHandler(async (req, res) => {
  try {
    const orderEntry = await OrderEntry.findById(req.params.id).populate([
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "salesmanName",
        select: "",
      },
      {
        path: "routeId",
        select: "",
      },
      {
        path: "retailerId",
        select: "",
        populate: [
          {
            path: "stateId",
            select: "",
            populate: {
              path: "zoneId",
              select: "",
            },
          },
          {
            path: "regionId",
            select: "",
          },
          {
            path: "beatId",
            select: "",
          },
        ],
      },
      {
        path: "lineItems.product",
        select: "",
      },
      {
        path: "lineItems.price",
        select: "",
      },
      {
        path: "lineItems.inventoryId",
        select: "",
      },
      { path: "billIds", select: "" },
    ]);

    if (!orderEntry) {
      res.status(404);
      throw new Error("Order Entry not found");
    }

    return res.status(200).json({
      status: 200,
      message: "Order Entry details retrieved successfully",
      data: orderEntry,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
}); // Get Order Entry Details by ID

module.exports = { detailOrderEntry };
