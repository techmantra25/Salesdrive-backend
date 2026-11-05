const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");
const Inventory = require("../../models/inventory.model");
const Godown = require("../../models/godown.model"); // adjust path/name

// "Rajarhat (GD001)"
const formatGodown = (g) =>
  g?.godownName
    ? `${g.godownName}${g.godownCode ? ` (${g.godownCode})` : ""}`
    : "";

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

    // Order's godown id (kept as a plain id, NOT populated, so the
    // matching logic below keeps working)
    const orderGodownId = orderData.godownId ? String(orderData.godownId) : null;
    const gid = (g) => (g ? String(g._id || g) : null);

    // --- LIVE INVENTORY OVERRIDE ---
    const distributorId = orderData.distributorId?._id;

    if (distributorId && Array.isArray(orderData.lineItems)) {
      const productIds = orderData.lineItems
        .map((li) => li.product?._id)
        .filter(Boolean);

      const liveInventories = await Inventory.find({
        distributorId,
        productId: { $in: productIds },
      })
        .populate("godownId", "godownName godownCode")
        .lean();

      const inventoryByProduct = {};
      for (const inv of liveInventories) {
        const pid = String(inv.productId);
        (inventoryByProduct[pid] ||= []).push(inv);
      }

      orderData.lineItems = orderData.lineItems.map((li) => {
        const records = inventoryByProduct[String(li.product?._id)] || [];
        const original = li.inventoryId;

        const orderGodownRecord = orderGodownId
          ? records.find((r) => gid(r.godownId) === orderGodownId)
          : null;

        const inventoryMismatch =
          !!original &&
          !!orderGodownId &&
          gid(original.godownId) !== orderGodownId;

        return {
          ...li,
          inventoryId: orderGodownRecord || original,
          inventoryMismatch,
          liveInventoryAcrossGodowns: records,
        };
      });
    }
    // --- END LIVE INVENTORY OVERRIDE ---

    // --- HEADER GODOWN LABEL ---
    if (orderGodownId) {
      const godown = await Godown.findById(orderGodownId)
        .select("godownName godownCode")
        .lean();
      orderData.godownName = formatGodown(godown);
    } else {
      orderData.godownName = "";
    }

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