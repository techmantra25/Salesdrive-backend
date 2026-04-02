const asyncHandler = require("express-async-handler");
const TransactionDraft = require("../../models/transactionDraft.model");
const Product = require("../../models/product.model");
const Inventory = require("../../models/inventory.model");

// Update the transaction draft based on the provided ID
const updateTransactionDraft = asyncHandler(async (req, res) => {
  try {
    const { transactionDraftId } = req.params;
    const { updateData } = req.body; // Ensure you are sending 'updateData' in the request body
    const distributorId = req.user?._id; // Get distributorId from the authenticated user

    if (!Array.isArray(updateData) || updateData.length === 0) {
      return res.status(400).json({
        error: true,
        message: "Invalid update data",
      });
    }

    // Map type field values and fetch productId for each item
    const mappedData = await Promise.all(
      updateData.map(async (item) => {
        if (item.type === "Add") {
          item.type = "In";
        } else if (item.type === "Reduce") {
          item.type = "Out";
        }

        // Fetch productId from product_code
        const product = await Product.findOne({
          product_code: item.product_code,
        });
        if (!product) {
          return null; // Skip this item if the product is not found
        }

        const inventory = await Inventory.findOne({
          productId: product._id,
          distributorId,
        });

        return {
          ...item,
          productId: product._id, // Add productId to the item
          distributorId, // Add distributorId from auth
          invItemId: inventory ? inventory._id : null, // Set invItemId from inventory if available
          description: item.description || null, // Ensure description is set
        };
      })
    );

    // Filter out any null items
    const filteredMappedData = mappedData.filter((item) => item !== null);

    // Replace the draft_data array with filteredMappedData
    const updatedTransactionDraft = await TransactionDraft.findByIdAndUpdate(
      transactionDraftId,
      {
        $set: {
          draft_data: filteredMappedData, // Completely replace the draft_data array with filteredMappedData
        },
      },
      { new: true, runValidators: true } // Return the updated document and validate
    );

    // Check if the draft was found and updated
    if (!updatedTransactionDraft) {
      return res.status(404).json({
        error: true,
        message: "Transaction draft not found",
      });
    }

    res.status(200).json({
      error: false,
      message: "Transaction draft updated successfully",
      data: updatedTransactionDraft,
    });
  } catch (error) {
    console.error("Error updating transaction draft:", error); // Add more detailed logging
    res.status(400).json({
      error: true,
      message: error.message || "Something went wrong",
    });
  }
});

module.exports = { updateTransactionDraft };
