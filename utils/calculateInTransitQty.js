const Invoice = require("../models/invoice.model");

/**
 * @param {ObjectId} distributorId - The distributor ID
 * @param {Date} startDate - Optional: Filter by creation date (start)
 * @param {Date} endDate - Optional: Filter by creation date (end)
 * @returns {Promise<Array>} Array of In-Transit invoices with populated line items
 */
const getInTransitInvoices = async (
  distributorId,
  startDate = null,
  endDate = null
) => {
  const filter = {
    distributorId,
    status: "In-Transit",
  };

  // Add date filtering if provided
  if (startDate && endDate) {
    filter.createdAt = { $gte: startDate, $lte: endDate };
  }

  return await Invoice.find(filter)
    .populate("lineItems.product", "_id product_code name")
    .lean(); // Use lean() for better performance
};

/**
 * @param {ObjectId} distributorId - The distributor ID
 * @param {Date} startDate - Optional: Filter by creation date (start)
 * @param {Date} endDate - Optional: Filter by creation date (end)
 * @returns {Promise<Map<string, number>>} Map of productId -> in-transit quantity
 */
const calculateInTransitMap = async (
  distributorId,
  startDate = null,
  endDate = null
) => {
  // Get all In-Transit invoices
  const inTransitInvoices = await getInTransitInvoices(
    distributorId,
    startDate,
    endDate
  );

  // Build a map: productId -> total receivedQty
  const inTransitMap = new Map();

  inTransitInvoices.forEach((invoice) => {
    invoice.lineItems.forEach((item) => {
      if (item.product && item.product._id) {
        const productId = item.product._id.toString();
        const receivedQty = item.receivedQty ?? 0; // Use nullish coalescing

        // Add to existing quantity or initialize
        inTransitMap.set(
          productId,
          (inTransitMap.get(productId) || 0) + receivedQty
        );
      }
    });
  });

  return inTransitMap;
};

/**
 * @param {Array} invoiceList - Array of In-Transit invoices (already fetched)
 * @param {ObjectId} productId - The product ID to check
 * @returns {number} Total in-transit quantity for this product
 */
const getInTransitQtyFromInvoiceList = (invoiceList, productId) => {
  // Ensure productId is a string
  const productIdStr = productId && productId.toString();

  // Filter In-Transit invoices and sum receivedQty for matching product
  const inTransitQty = invoiceList
    .filter((invoice) => invoice.status === "In-Transit")
    .reduce((total, invoice) => {
      // Sum receivedQty for this product in current invoice
      const qtyInInvoice = invoice.lineItems
        .filter(
          (item) =>
            item.product &&
            item.product._id &&
            item.product._id.toString() === productIdStr
        )
        .reduce((sum, item) => sum + (item.receivedQty ?? 0), 0);

      return total + qtyInInvoice;
    }, 0);

  return inTransitQty;
};

/**
 * @param {ObjectId} distributorId - The distributor ID
 * @param {ObjectId} productId - The product ID to check
 * @param {Date} startDate - Optional: Filter by creation date (start)
 * @param {Date} endDate - Optional: Filter by creation date (end)
 * @returns {Promise<number>} Total in-transit quantity for this product
 */
const getInTransitQtyForProduct = async (
  distributorId,
  productId,
  startDate = null,
  endDate = null
) => {
  const filter = {
    distributorId,
    status: "In-Transit",
    "lineItems.product": productId,
  };

  // Add date filtering if provided
  if (startDate && endDate) {
    filter.createdAt = { $gte: startDate, $lte: endDate };
  }

  // Use aggregation for efficient single-product query
  const result = await Invoice.aggregate([
    { $match: filter },
    { $unwind: "$lineItems" },
    {
      $match: {
        "lineItems.product": productId,
      },
    },
    {
      $group: {
        _id: null,
        totalQty: { $sum: "$lineItems.receivedQty" },
      },
    },
  ]);

  return result[0]?.totalQty || 0;
};

/**
 * @param {ObjectId} distributorId - The distributor ID
 * @param {Array<ObjectId>} productIds - Array of product IDs
 * @param {Date} startDate - Optional: Filter by creation date (start)
 * @param {Date} endDate - Optional: Filter by creation date (end)
 * @returns {Promise<Map<string, number>>} Map of productId -> in-transit quantity
 */
const getInTransitQtyForProducts = async (
  distributorId,
  productIds,
  startDate = null,
  endDate = null
) => {
  const filter = {
    distributorId,
    status: "In-Transit",
  };

  // Add date filtering if provided
  if (startDate && endDate) {
    filter.createdAt = { $gte: startDate, $lte: endDate };
  }

  // Use aggregation to get quantities for specific products
  const result = await Invoice.aggregate([
    { $match: filter },
    { $unwind: "$lineItems" },
    {
      $match: {
        "lineItems.product": { $in: productIds },
      },
    },
    {
      $group: {
        _id: "$lineItems.product",
        totalQty: { $sum: "$lineItems.receivedQty" },
      },
    },
  ]);

  // Convert to Map
  const inTransitMap = new Map();
  result.forEach((item) => {
    inTransitMap.set(item._id.toString(), item.totalQty);
  });

  return inTransitMap;
};

/**
 * @param {Array} inventoryItems - Array of inventory items with productId
 * @param {Map<string, number>} inTransitMap - Map of productId -> quantity
 * @returns {Array} Inventory items with intransitQty added
 */
const addInTransitQtyToInventory = (inventoryItems, inTransitMap) => {
  return inventoryItems.map((invItem) => {
    const productId = invItem.productId
      ? invItem.productId.toString()
      : invItem._id?.toString();

    const intransitQty = inTransitMap.get(productId) || 0;

    return {
      ...invItem,
      intransitQty,
    };
  });
};

module.exports = {
  // Main functions to use
  calculateInTransitMap, // ✅ BEST for multiple products (inventory list, dashboard)
  getInTransitQtyForProduct, // For single product queries
  getInTransitQtyForProducts, // For specific set of products

  // Helper/utility functions
  getInTransitInvoices, // Get raw invoice data
  getInTransitQtyFromInvoiceList, // Original logic (for backward compatibility)
  addInTransitQtyToInventory, // Helper to map data to inventory
};
