const asyncHandler = require("express-async-handler");
const { generateCode } = require("../../utils/codeGenerator");
const TransactionDraft = require("../../models/transactionDraft.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");

const draftCreate = asyncHandler(async (req, res) => {
  try {
    const { data } = req.body;
    const distributorId = req.user?._id; // Assuming you get distributorId from authentication
    const transactionDraftId = await generateCode("LXTD"); // Generate transaction draft ID

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        status: 400,
        message: "Data must be an array and cannot be empty",
      });
    }

    const transactionDrafts = [];

    await Promise.all(
      data.map(async (item, index) => {
        const { product_code, qty, type, stockType, remarks } = item;

        // Find the product by product_code
        const product = await Product.findOne({ product_code });
        if (!product) {
          throw new Error(
            `Product with code ${product_code} not found at row ${index + 1}`
          );
        }

        // Find the inventory for the product and distributor
        const inventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
        });

        if (!inventory) {
          throw new Error(
            `Inventory not found for Product ${product_code} at row ${
              index + 1
            }`
          );
        }

        const invItemId = inventory._id;

        // Create transaction draft object
        const transactionDraftData = {
          distributorId,
          productId: product._id,
          transactionDraftId,
          invItemId,
          qty: Number(qty), // Ensure qty is a number
          date: new Date(), // Use current date for transaction
          type: type === "Add" ? "In" : "Out", // Map adjustment to type
          description: remarks || "No description provided", // Default description
          stockType: stockType,
        };

        transactionDrafts.push(transactionDraftData);
      })
    );

    // Save all transaction drafts in a single operation
    const savedDrafts = await TransactionDraft.create({
      draft_data: transactionDrafts,
      transactionDraftId, // Attach the generated transactionDraftId
    });

    return res.status(201).json({
      status: 201,
      message: "Transaction drafts created successfully",
      data: savedDrafts,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { draftCreate };
