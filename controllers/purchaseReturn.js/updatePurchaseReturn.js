const asyncHandler = require("express-async-handler");
const PurchaseReturn = require("../../models/purchaseReturn.model");
const Invoice = require("../../models/invoice.model");
const Transaction = require("../../models/transaction.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Distributor = require("../../models/distributor.model");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const { transactionCode } = require("../../utils/codeGenerator");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");
const {
  recalculateStockLedgerAfterDeletion,
} = require("../../controllers/transction/createStockLedgerEntry");

const updatePurchaseReturn = asyncHandler(async (req, res) => {
  try {
    const { prId } = req.params;

    // Find the existing purchase return
    const existingPurchaseReturn = await PurchaseReturn.findById(prId);
    if (!existingPurchaseReturn) {
      return res.status(404).json({
        message: "Purchase return not found",
      });
    }

    // Use the distributorId from the existing purchase return document instead of req.user._id
    // This is important when admin is updating the purchase return
    const distributorId = existingPurchaseReturn.distributorId;

    // Check if status is being changed to "Return Approved"
    if (
      req?.body?.status === "Return Approved" &&
      existingPurchaseReturn.status == "Return Requested"
    ) {
      // Process stock out transactions for each line item
      const stockId = await transactionCode("LXSTA");
      let successCount = 0;
      let failCount = 0;
      const errorLogs = [];
      const successfulProcesses = []; // Track successful processing for rollback

      // Update the purchase return with all fields including status
      const updatedFields = { ...req.body, status: "Return Approved" };
      const updatedPurchaseReturn = await PurchaseReturn.findByIdAndUpdate(
        prId,
        updatedFields,
        { new: true },
      );

      for (let i = 0; i < updatedPurchaseReturn.lineItems.length; i++) {
        const item = updatedPurchaseReturn.lineItems[i];

        // Determine quantity to return (use returnedQty if available, otherwise qty)
        //  const returnQty = item.returnedQty > 0 ? item.returnedQty : item.qty;

        const returnQty = item.qty || 0;

        if (returnQty <= 0) {
          successCount++;
          continue;
        }

        try {
          // Process the stock out transaction
          const processResult = await processStockOutForReturn(
            item,
            updatedPurchaseReturn,
            distributorId,
            stockId,
            returnQty,
          );

          // Track successful processing for potential rollback
          successfulProcesses.push({
            item,
            returnQty,
            inventory: processResult.inventory,
            transaction: processResult.transaction,
          });

          // Mark item as processed
          successCount++;
        } catch (error) {
          failCount++;
          const errorMessage = `Failed to process return for product ${item.product}: ${error.message}`;
          console.error(errorMessage);
          errorLogs.push({
            product: item.product,
            error: error.message,
            lineItemIndex: i,
          });
        }
      }

      // If there were failures, rollback successful changes and revert status
      if (failCount > 0) {
        //new
        const deletedTransactions = [];
        // Rollback inventory changes and delete transactions
        for (const success of successfulProcesses) {
          try {
            // Restore inventory quantities
            success.inventory.availableQty += success.returnQty;
            // Recalculate price per piece for rollback
            const productData = await Product.findOne({
              _id: success.item.product,
            });
            let priceResponse = await axios.get(
              `${SERVER_URL}/api/v1/price/product-pricing/${success.item.product}?distributorId=${distributorId}`,
            );
            const priceEntry = priceResponse?.data?.data[0];
            let rlpbyPcs = 0;
            let dlpbyPcs = 0;
            if (productData.uom === "box") {
              const piecesPerBox = productData.no_of_pieces_in_a_box || 1;
              rlpbyPcs = priceEntry.rlp_price / piecesPerBox;
              dlpbyPcs = priceEntry.dlp_price / piecesPerBox;
            } else {
              rlpbyPcs = priceEntry.rlp_price || 0;
              dlpbyPcs = priceEntry.dlp_price || 0;
            }
            success.inventory.totalStockamtDlp += dlpbyPcs * success.returnQty;
            success.inventory.totalStockamtRlp += rlpbyPcs * success.returnQty;
            await success.inventory.save();

            deletedTransactions.push({
              _id: success.transaction._id,
              distributorId: success.transaction.distributorId,
              productId: success.transaction.productId,
              date: success.transaction.date,
              type: success.transaction.type,
              qty: success.transaction.qty,
              transactionType: success.transaction.transactionType,
            });

            // Delete the transaction
            await Transaction.findByIdAndDelete(success.transaction._id);
          } catch (rollbackError) {
            console.error(
              `Failed to rollback changes for product ${success.item.product}:`,
              rollbackError.message,
            );
          }
        }
        if (deletedTransactions.length > 0) {
          await (async () => {
            try {
              await recalculateStockLedgerAfterDeletion(deletedTransactions);
              console.log(
                `✅ Stock ledger recalculated after rollback for ${deletedTransactions.length} transactions`,
              );
            } catch (ledgerError) {
              console.error(
                "Failed to recalculate stock ledger:",
                ledgerError.message,
              );
            }
          })();
        }

        // Revert status back to "Return Requested"
        updatedPurchaseReturn.status = "Return Requested";
        await updatedPurchaseReturn.save();
      } else {
        // Handle reward points for the return if applicable (only on complete success)
        await processReturnRewardPoints(updatedPurchaseReturn);
      }

      const responseData = {
        status: 200,
        message:
          failCount > 0
            ? `${failCount}/${updatedPurchaseReturn.lineItems.length} product(s) failed to process`
            : "Purchase return approved and processed successfully",
        data: updatedPurchaseReturn,
      };

      if (failCount > 0) {
        responseData.errorLogs = errorLogs;
      }

      return res.status(200).json(responseData);
    } else {
      // For all other status updates, only update non-status fields
      // If status is in the request body but it's not "Return Approved", remove it
      const updatedFields = { ...req.body };

      // Only allow status update if it's specifically "Return Approved"
      if (req.body.status && req.body.status !== "Return Approved") {
        delete updatedFields.status; // Don't update the status field if it's not "Return Approved"
      }

      const updatedPurchaseReturn = await PurchaseReturn.findByIdAndUpdate(
        prId,
        updatedFields,
        { new: true },
      );

      return res.status(200).json({
        status: 200,
        message: "Purchase return updated successfully",
        data: updatedPurchaseReturn,
      });
    }
  } catch (error) {
    console.error("Error updating purchase return:", error);
    res.status(400);
    throw error;
  }
});

// Helper function to process stock out for purchase return
const processStockOutForReturn = async (
  item,
  purchaseReturn,
  distributorId,
  stockId,
  returnQty,
) => {
  const { product } = item;

  // Fetch product details
  const productData = await Product.findOne({ _id: product });
  if (!productData) {
    throw new Error(`Product with ID ${product} not found`);
  }

  // Fetch price
  let priceResponse;
  try {
    priceResponse = await axios.get(
      `${SERVER_URL}/api/v1/price/product-pricing/${product}?distributorId=${distributorId}`,
    );
  } catch (error) {
    throw new Error(
      `Failed to fetch price for product ${productData.product_code}: ${error.message}`,
    );
  }

  const priceEntry = priceResponse?.data?.data[0];
  if (!priceEntry) {
    throw new Error(`Price not found for product ${productData.product_code}`);
  }

  // Calculate RLP and DLP price per piece
  let rlpbyPcs = 0;
  let dlpbyPcs = 0;
  if (productData.uom === "box") {
    const piecesPerBox = productData.no_of_pieces_in_a_box || 1;
    rlpbyPcs = priceEntry.rlp_price / piecesPerBox;
    dlpbyPcs = priceEntry.dlp_price / piecesPerBox;
  } else {
    rlpbyPcs = priceEntry.rlp_price || 0;
    dlpbyPcs = priceEntry.dlp_price || 0;
  }

  // Update or find Inventory
  let inventory = await Inventory.findOne({
    productId: product,
    distributorId: purchaseReturn.distributorId,
    godownType: "main",
  });

  if (!inventory) {
    throw new Error(
      `Inventory not found for product ${productData.product_code}`,
    );
  }

  // Check if sufficient stock is available for return
  if (inventory.availableQty < returnQty) {
    throw new Error(
      `Insufficient stock available for product ${productData.product_code}. Available: ${inventory.availableQty}, Requested: ${returnQty}`,
    );
  }

  // Reduce available quantity and update stock amounts
  inventory.availableQty -= returnQty;
  inventory.totalStockamtDlp -= dlpbyPcs * returnQty;
  inventory.totalStockamtRlp -= rlpbyPcs * returnQty;

  // Ensure values don't go below zero
  inventory.availableQty = Math.max(0, inventory.availableQty);
  inventory.totalStockamtDlp = Math.max(0, inventory.totalStockamtDlp);
  inventory.totalStockamtRlp = Math.max(0, inventory.totalStockamtRlp);

  await inventory.save();

  // Create Stock Out Transaction
  const transaction = new Transaction({
    distributorId: purchaseReturn.distributorId,
    productId: product,
    invItemId: inventory._id,
    transactionId: stockId,
    qty: returnQty,
    date: new Date(),
    type: "Out", // Stock out for return
    balanceCount: inventory.availableQty,
    description: `Purchase Return ${purchaseReturn.code} - Stock returned`,
    transactionType: "purchasereturn", // Using purchasereturn for returns
    stockType: "salable",
  });

  await transaction.save();

  return { success: true, inventory, transaction };
};

// Function to handle reward points for return (reverse points if previously given)
const processReturnRewardPoints = async (purchaseReturn) => {
  // Get the associated invoice for reference
  const invoice = await Invoice.findById(purchaseReturn.invoiceId);
  if (!invoice) {
    console.log(`Invoice not found for purchase return ${purchaseReturn.code}`);
    return;
  }

  // Get distributor info
  const distributor = await Distributor.findById(
    purchaseReturn.distributorId,
  ).lean();
  if (!distributor) {
    console.log(
      `Distributor not found for ID: ${purchaseReturn.distributorId}`,
    );
    return;
  }

  // Check if RBP scheme is mapped
  if (distributor.RBPSchemeMapped !== "yes") {
    console.log(
      `Skipping reward points reverse - RBP scheme not mapped for distributor ${distributor.dbCode}`,
    );
    return;
  }

  let returnPoints = 0;

  for (const item of purchaseReturn.lineItems) {
    const { product, returnedQty = 0, qty = 0 } = item;
    const productData = await Product.findOne({ _id: product });

    const base_point = Number(
      item?.usedBasePoint ?? productData?.base_point ?? 0,
    );

    if (isNaN(base_point) || base_point <= 0) continue;

    // Use qty as the return quantity
    const returnQuantity = qty;
    returnPoints += base_point * returnQuantity;
  }

  if (returnPoints > 0) {
    const latestTransaction = await DistributorTransaction.findOne({
      distributorId: purchaseReturn.distributorId,
    }).sort({ createdAt: -1 });

    const balance = latestTransaction
      ? Number(latestTransaction.balance) - Number(returnPoints) // Subtract points for return
      : 0; // If no previous transactions, balance remains 0

    const newTransaction = new DistributorTransaction({
      distributorId: purchaseReturn.distributorId,
      transactionType: "debit", // Debit points for return
      transactionFor: "Purchase Return",
      point: returnPoints, // Points deducted for return
      balance: Math.max(0, balance), // Prevent negative balance
      purchaseReturnId: purchaseReturn._id,
      status: "Success",
      remark: `Reward points deduction for purchase return ${purchaseReturn.code} for DB Code ${distributor.dbCode}`,
    });

    await newTransaction.save();
    console.log(
      `Created return reward transaction: -${returnPoints} points for ${distributor.dbCode}`,
    );
  }
};

module.exports = { updatePurchaseReturn };
