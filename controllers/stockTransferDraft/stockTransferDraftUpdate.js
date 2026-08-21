const asyncHandler = require("express-async-handler");
const StockTransferDraft = require("../../models/stockTransferDraft.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");

// Same mapping as stockTransfer.js / stockTransferDraftCreate.js — which
// Inventory field holds the available qty for a given stockType bucket.
// "pending" is intentionally excluded — pendingOrderQty isn't physical
// stock held against a godown.
const STOCK_FIELD_MAP = {
  salable: "availableQty",
  unsalable: "unsalableQty",
  offer: "offerQty",
  reserve: "reservedQty",
  intransit: "intransitQty",
};

// Update the stock transfer draft based on the provided draft ID
const stockTransferDraftUpdate = asyncHandler(async (req, res) => {
  try {
    const { transferDraftId } = req.params;
    const { updateData, godownIdFrom, godownIdTo } = req.body;
    const distributorId = req.user?._id;

    if (!Array.isArray(updateData) || updateData.length === 0) {
      return res.status(400).json({
        error: true,
        message: "Invalid update data",
      });
    }

    if (!godownIdFrom || !godownIdTo) {
      return res.status(400).json({
        error: true,
        message: "From Godown and To Godown are required",
      });
    }

    if (String(godownIdFrom) === String(godownIdTo)) {
      return res.status(400).json({
        error: true,
        message: "From Godown and To Godown cannot be the same",
      });
    }

    // Map + validate each row, same as create — re-checked here because the
    // draft's items may have changed since it was first saved, and source
    // inventory may have moved in the meantime too.
    const mappedData = await Promise.all(
      updateData.map(async (item, index) => {
        const { product_code, product_name, qty, stockType, remarks } = item;

        const parsedQty = Number(qty);

        if (!product_code) {
          throw new Error(`Product code is required at row ${index + 1}`);
        }

        if (isNaN(parsedQty) || parsedQty <= 0) {
          throw new Error(
            `Invalid quantity for Product code: ${product_code} at row ${
              index + 1
            }`
          );
        }

        const normalizedStockType = stockType?.trim().toLowerCase();
        const qtyField = STOCK_FIELD_MAP[normalizedStockType];

        if (!qtyField) {
          throw new Error(
            normalizedStockType === "pending"
              ? `Pending Order Qty cannot be drafted for transfer — it isn't physical stock held against a godown, for Product code: ${product_code}`
              : `Unknown stock type "${stockType}" for Product code: ${product_code} at row ${
                  index + 1
                }`
          );
        }

        // Fetch productId from product_code
        const product = await Product.findOne({ product_code });
        if (!product) {
          throw new Error(
            `Product with code ${product_code} not found at row ${index + 1}`
          );
        }

        // Re-validate against CURRENT source-godown inventory at update time.
        const sourceInventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
          godownId: godownIdFrom,
        });

        if (!sourceInventory) {
          throw new Error(
            `No inventory found for Product code ${product_code} in the source godown`
          );
        }

        const availableInSource = sourceInventory[qtyField] || 0;

        if (parsedQty > availableInSource) {
          throw new Error(
            `Insufficient ${normalizedStockType} stock in source godown for Product code: ${product_code} (available: ${availableInSource}, requested: ${parsedQty})`
          );
        }

        return {
          productId: product._id,
          product_code,
          product_name: product_name || product.name,
          stockType: normalizedStockType,
          godownIdFrom,
          godownIdTo,
          qty: parsedQty,
          remarks: remarks || "",
        };
      })
    );

    // Replace the draft_data array (and from/to godowns) with the fresh set
    const updatedStockTransferDraft = await StockTransferDraft.findOneAndUpdate(
      { transferDraftId, distributorId },
      {
        $set: {
          godownIdFrom,
          godownIdTo,
          draft_data: mappedData,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedStockTransferDraft) {
      return res.status(404).json({
        error: true,
        message: "Stock transfer draft not found",
      });
    }

    res.status(200).json({
      error: false,
      message: "Stock transfer draft updated successfully",
      data: updatedStockTransferDraft,
    });
  } catch (error) {
    console.error("Error updating stock transfer draft:", error);
    res.status(400).json({
      error: true,
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = { stockTransferDraftUpdate };