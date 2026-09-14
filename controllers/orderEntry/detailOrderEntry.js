const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");
const Inventory = require("../../models/inventory.model"); // adjust path/name as needed

// Get Order Entry Details by ID
const detailOrderEntry = asyncHandler(async (req, res) => {
  try {
    const orderEntry = await OrderEntry.findById(req.params.id).populate([
      { path: "distributorId", select: "" },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      {
        path: "retailerId",
        select: "",
        populate: [
          {
            path: "stateId",
            select: "",
            populate: { path: "zoneId", select: "" },
          },
          { path: "regionId", select: "" },
          { path: "beatId", select: "" },
        ],
      },
      { path: "lineItems.product", select: "" },
      { path: "lineItems.price", select: "" },
      { path: "lineItems.inventoryId", select: "" }, // kept, but overridden below
      { path: "billIds", select: "" },
    ]);

    if (!orderEntry) {
      res.status(404);
      throw new Error("Order Entry not found");
    }

    const orderData = orderEntry.toObject();

    if (orderData.salesmanName?._id && orderData.retailerId?._id) {
      const salesmanId = orderData.salesmanName._id;
      const retailerId = orderData.retailerId._id;

      const outlet = await OutletApproved.findOne({
        _id: retailerId,
        employeeId: salesmanId,
        status: true,
      }).select("employeeId beatId");

      if (outlet?.beatId?.length) {
        const salesmanRoute = await Beat.findOne({
          _id: { $in: outlet.beatId },
          status: true,
        });

        if (salesmanRoute) {
          orderData.routeId = salesmanRoute;
        }
      }
    }

    if (orderData.manualOrderDate) {
      orderData.createdAt = orderData.manualOrderDate;
    }

    // --- LIVE INVENTORY OVERRIDE ---
    // Re-fetch live inventory per product for this distributor, across ALL
    // godowns, so the response reflects current stock rather than a stale
    // inventoryId that may point at an empty/wrong godown.
    const distributorId = orderData.distributorId?._id;

    if (distributorId && Array.isArray(orderData.lineItems)) {
      const productIds = orderData.lineItems
        .map((li) => li.product?._id)
        .filter(Boolean);

      const liveInventories = await Inventory.find({
        distributorId,
        productId: { $in: productIds },
      })
        .populate("godownId", "name") // adjust field name if different
        .lean();

      // Group live inventory records by productId
      const inventoryByProduct = {};
      for (const inv of liveInventories) {
        const pid = String(inv.productId);
        if (!inventoryByProduct[pid]) inventoryByProduct[pid] = [];
        inventoryByProduct[pid].push(inv);
      }

      orderData.lineItems = orderData.lineItems.map((li) => {
        const pid = String(li.product?._id);
        const records = inventoryByProduct[pid] || [];

        // Pick the godown record with stock, if the currently-linked one is empty.
        // Preference: keep original if it has stock; otherwise use the first
        // record with availableQty > 0; otherwise fall back to original.
        const original = li.inventoryId;
        const originalHasStock = original && original.availableQty > 0;

        const bestAlternate = records.find((r) => r.availableQty > 0);

        return {
          ...li,
          inventoryId: originalHasStock ? original : bestAlternate || original,
          liveInventoryAcrossGodowns: records, // optional: expose all godown stock for transparency
        };
      });
    }
    // --- END LIVE INVENTORY OVERRIDE ---

    return res.status(200).json({
      status: 200,
      message: "Order Entry details retrieved successfully",
      data: orderData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailOrderEntry };