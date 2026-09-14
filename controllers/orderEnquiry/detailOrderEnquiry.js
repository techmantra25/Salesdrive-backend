const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const Inventory = require("../../models/inventory.model"); // adjust path/name as needed

const detailOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const orderEnquiry = await OrderEnquiry.findById(req.params.id).populate([
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
      { path: "lineItems.inventoryId", select: "" },
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
    // Re-fetch live inventory per product for this distributor, across ALL
    // godowns, so the response reflects current stock rather than a stale
    // inventoryId that may point at an empty/wrong godown.
    const distributorId = responseData.distributorId?._id;

    if (distributorId && Array.isArray(responseData.lineItems)) {
      const productIds = responseData.lineItems
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

      responseData.lineItems = responseData.lineItems.map((li) => {
        const pid = String(li.product?._id);
        const records = inventoryByProduct[pid] || [];

        // Pick the godown record with stock, if the currently-linked one is empty.
        const original = li.inventoryId;
        const originalHasStock = original && original.availableQty > 0;

        const bestAlternate = records.find((r) => r.availableQty > 0);

        return {
          ...li,
          inventoryId: originalHasStock ? original : bestAlternate || original,
          liveInventoryAcrossGodowns: records, // optional: full breakdown for transparency
        };
      });
    }
    // --- END LIVE INVENTORY OVERRIDE ---

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