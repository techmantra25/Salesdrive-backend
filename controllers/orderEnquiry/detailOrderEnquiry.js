const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const Inventory = require("../../models/inventory.model");

// Builds "Name (CODE)" from a populated godown doc, trying common field names.
const formatGodown = (g) => {
  if (!g || typeof g !== "object") return "";
  const name = g.godownName || g.godown_name || g.name || g.title || "";
  const code = g.godownCode || g.godown_code || g.code || "";
  if (name && code) return `${name} (${code})`;
  return name || code || "";
};

const detailOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const orderEnquiry = await OrderEnquiry.findById(req.params.id).populate([
      { path: "distributorId", select: "" },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      { path: "godownId", select: "" },
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
      {
        path: "lineItems.inventoryId",
        select: "",
        populate: { path: "godownId", select: "" },
      },
      { path: "convertedOrderEntryId", select: "" },
      {
        path: "adjustedCreditNoteIds.creditNoteId",
        model: "CreditNote",
        select:
          "creditNoteNo creditNoteType amount creditNoteStatus adjustedBillIds",
      },
    ]);

    if (!orderEnquiry) {
      res.status(404);
      throw new Error("Order Enquiry not found");
    }

    const responseData = orderEnquiry.toObject();
    responseData.createdAt = responseData.manualDate;

    // --- LIVE INVENTORY OVERRIDE ---
    const distributorId = responseData.distributorId?._id;

    if (distributorId && Array.isArray(responseData.lineItems)) {
      const productIds = responseData.lineItems
        .map((li) => li.product?._id)
        .filter(Boolean);

      const liveInventories = await Inventory.find({
        distributorId,
        productId: { $in: productIds },
      })
        .populate("godownId", "")
        .lean();

      const inventoryByProduct = {};
      for (const inv of liveInventories) {
        const pid = String(inv.productId);
        if (!inventoryByProduct[pid]) inventoryByProduct[pid] = [];
        inventoryByProduct[pid].push(inv);
      }

      responseData.lineItems = responseData.lineItems.map((li) => {
        const pid = String(li.product?._id);
        const records = inventoryByProduct[pid] || [];

        const original = li.inventoryId;
        const originalHasStock = original && original.availableQty > 0;
        const bestAlternate = records.find((r) => r.availableQty > 0);

        const chosenInventory = originalHasStock
          ? original
          : bestAlternate || original;

        const godownLabel =
          formatGodown(chosenInventory?.godownId) ||
          formatGodown(
            records.find((r) => String(r._id) === String(chosenInventory?._id))
              ?.godownId
          );

        return {
          ...li,
          inventoryId: chosenInventory,
          godownName: godownLabel,
          liveInventoryAcrossGodowns: records,
        };
      });
    }
    // --- END LIVE INVENTORY OVERRIDE ---

    // Header-level label: saved godown on the enquiry, else first line item's
    responseData.godownName =
      formatGodown(responseData.godownId) ||
      responseData.lineItems?.find((li) => li.godownName)?.godownName ||
      "";

    return res.status(200).json({
      status: 200,
      message: "Order Enquiry details retrieved successfully",
      data: responseData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { detailOrderEnquiry };