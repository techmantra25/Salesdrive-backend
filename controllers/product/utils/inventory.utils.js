const Inventory = require("../../../models/inventory.model");
const Invoice = require("../../../models/invoice.model");
const getInTransitQty = require("../../../utils/getInTransitQty");

const getBatchInventoryStock = async (productIds, distributorId) => {
  try {
    //fetch all inventory for all product
    const inventories = await Inventory.find({
      productId: { $in: productIds },
      distributorId: distributorId,
      godownType: "main",
    }).lean();

    const inTransitInvoices = await Invoice.find({
      distributorId: distributorId,
      status: "In-Transit",
    })
      .populate("lineItems.product")
      .lean();

    const inventoryByProduct = {};
    inventories.forEach((inv) => {
      const productId = inv.productId.toString();
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
