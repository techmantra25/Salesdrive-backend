const asyncHandler = require("express-async-handler");
const { generateCode } = require("../../utils/codeGenerator");
const StockTransferDraft = require("../../models/stockTransferDraft.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");

// Same mapping as stockTransfer.js — which Inventory field holds the
// available qty for a given stockType bucket. "pending" is intentionally
// excluded: pendingOrderQty isn't physical stock held against a godown, so
// it can never be validated or drafted for transfer.
const STOCK_FIELD_MAP = {
  salable: "availableQty",
  unsalable: "unsalableQty",
  offer: "offerQty",
  reserve: "reservedQty",
  intransit: "intransitQty",
};

const stockTransferDraftCreate = asyncHandler(async (req, res) => {
  try {
    const { data, godownIdFrom, godownIdTo } = req.body;
    const distributorId = req.user?._id;
    const createdBy = req.user?.id;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        status: 400,
        message: "Data must be an array and cannot be empty",
      });
    }

    if (!godownIdFrom || !godownIdTo) {
      return res.status(400).json({
        status: 400,
        message: "From Godown and To Godown are required",
      });
    }

    if (String(godownIdFrom) === String(godownIdTo)) {
      return res.status(400).json({
        status: 400,
        message: "From Godown and To Godown cannot be the same",
      });
    }

    const transferDraftId = await generateCode("LXSTD");
    const draftItems = [];

    await Promise.all(
      data.map(async (item, index) => {
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

        // Find the product by product_code
        const product = await Product.findOne({ product_code });
        if (!product) {
          throw new Error(
            `Product with code ${product_code} not found at row ${index + 1}`
          );
        }

        // Validate against the CURRENT source-godown inventory at save time,
        // same as the live stockTransfer controller does. This keeps a
        // draft from being saved with qty that's already unavailable, even
        // though the draft won't move any stock until it's submitted.
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

        draftItems.push({
          productId: product._id,
          product_code,
          product_name: product_name || product.name,
          stockType: normalizedStockType,
          godownIdFrom,
          godownIdTo,
          qty: parsedQty,
          remarks: remarks || "",
        });
      })
    );

    const savedDraft = await StockTransferDraft.create({
      distributorId,
      transferDraftId,
      godownIdFrom,
      godownIdTo,
      draft_data: draftItems,
      status: "Draft",
      createdBy,
    });

    return res.status(201).json({
      status: 201,
      message: "Stock transfer draft created successfully",
      data: savedDraft,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { stockTransferDraftCreate };