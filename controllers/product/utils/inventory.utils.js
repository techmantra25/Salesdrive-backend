const Inventory = require("../../../models/inventory.model");
const Invoice = require("../../../models/invoice.model");
const getInTransitQty = require("../../../utils/getInTransitQty");

const getBatchInventoryStock = async (productIds, distributorId, godownId) => {
  try {
    // Base filter — always scoped to this distributor's products
    const inventoryFilter = {
      productId: { $in: productIds },
      distributorId: distributorId,
    };

    if (godownId && godownId !== "undefined" && godownId !== "null") {
      // A specific godown was selected — filter to that godown only,
      // regardless of godownType, since the user explicitly picked it.
      inventoryFilter.godownId = godownId;
    } else {
      // No godown selected — fall back to the original "main" godown
      // behavior so existing (no-godown-filter) callers are unaffected.
      inventoryFilter.godownType = "main";
    }

    //fetch all inventory for all product
    const inventories = await Inventory.find(inventoryFilter).lean();

    const inTransitInvoices = await Invoice.find({
      distributorId: distributorId,
      status: "In-Transit",
    })
      .populate("lineItems.product")
      .lean();

    const inventoryByProduct = {};
    inventories.forEach((inv) => {
      const productId = inv.productId.toString();
      // NOTE: if a product has more than one matching inventory row
      // (e.g. multiple "main" godowns when no godownId is passed), this
      // keeps only the last one encountered — same as the original
      // behavior. When godownId is passed, productId+godownId is unique
      // per distributor, so there's exactly one row and this is safe.
      inventoryByProduct[productId] = inv;
    });

    const result = {};

    productIds.forEach((productId) => {
      const inventory = inventoryByProduct[productId] || null;

      const intransitQty = inventory
        ? getInTransitQty(inTransitInvoices, inventory.productId)
        : 0;

      result[productId] = inventory
        ? {
            ...inventory,
            intransitQty: intransitQty,
          }
        : null;
    });
    return result;
  } catch (error) {
    console.error("Error in getBatchInventoryStock:", error);
    throw error;
  }
};

module.exports = {
  getBatchInventoryStock,
};