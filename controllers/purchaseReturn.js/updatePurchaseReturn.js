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

// ================= EXTRACTED APPROVAL LOGIC (Step 6 in updatePurchaseReturn, reused by createPurchaseReturn) =================
const approvePurchaseReturn = async (purchaseReturn, distributorId) => {
  const stockId = await transactionCode("LXSTA");
  let successCount = 0;
  let failCount = 0;
  const errorLogs = [];
  const successfulProcesses = [];

  for (let i = 0; i < purchaseReturn.lineItems.length; i++) {
    const item = purchaseReturn.lineItems[i];
    const returnQty = item.qty || 0;

    if (returnQty <= 0) {
      successCount++;
      continue;
    }

    try {
      const processResult = await processStockOutForReturn(
        item,
        purchaseReturn,
        distributorId,
        stockId,
        returnQty,
      );

      successfulProcesses.push({
        item,
        returnQty,
        inventory: processResult.inventory,
        transaction: processResult.transaction,
      });

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

  if (failCount > 0) {
    const deletedTransactions = [];

    for (const success of successfulProcesses) {
      try {
        success.inventory.availableQty += success.returnQty;

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

        await Transaction.findByIdAndDelete(success.transaction._id);
      } catch (rollbackError) {
        console.error(
          `Failed to rollback changes for product ${success.item.product}:`,
          rollbackError.message,
        );
      }
    }

    if (deletedTransactions.length > 0) {
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
    }

    purchaseReturn.status = "Return Requested";
    await purchaseReturn.save();

    return {
      success: false,
      failCount,
      successCount,
      total: purchaseReturn.lineItems.length,
      errorLogs,
    };
  }

  await processReturnRewardPoints(purchaseReturn);
  return { success: true, successCount, total: purchaseReturn.lineItems.length };
};

const updatePurchaseReturn = asyncHandler(async (req, res) => {
  try {
    const { prId } = req.params;

    const existingPurchaseReturn = await PurchaseReturn.findById(prId);
    if (!existingPurchaseReturn) {
      return res.status(404).json({
        message: "Purchase return not found",
      });
    }

    const distributorId = existingPurchaseReturn.distributorId;

    if (
      req?.body?.status === "Returned" &&
      existingPurchaseReturn.status == "Return Requested"
    ) {
      const updatedFields = { ...req.body, status: "Returned" };
      const updatedPurchaseReturn = await PurchaseReturn.findByIdAndUpdate(
        prId,
        updatedFields,
        { new: true },
      );

      const result = await approvePurchaseReturn(updatedPurchaseReturn, distributorId);

      const responseData = {
        status: 200,
        message: result.success
          ? "Purchase returned and processed successfully"
          : `${result.failCount}/${result.total} product(s) failed to process`,
        data: updatedPurchaseReturn,
      };

      if (!result.success) {
        responseData.errorLogs = result.errorLogs;
      }

      return res.status(200).json(responseData);
    } else {
      const updatedFields = { ...req.body };

      if (req.body.status && req.body.status !== "Returned") {
        delete updatedFields.status;
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

  const productData = await Product.findOne({ _id: product });
  if (!productData) {
    throw new Error(`Product with ID ${product} not found`);
  }

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

  // ⚠️ STEP 3 FIX: was `godownType: "main"` (hardcoded, ignores which godown the
  // invoice/return actually belongs to). Now scoped to the return's own godown.
  let inventory = await Inventory.findOne({
    productId: product,
    distributorId: purchaseReturn.distributorId,
    godownId: purchaseReturn.godownId,
  });

  if (!inventory) {
    throw new Error(
      `Inventory not found for product ${productData.product_code} in the return's godown`,
    );
  }

  if (inventory.availableQty < returnQty) {
    throw new Error(
      `Insufficient stock available for product ${productData.product_code}. Available: ${inventory.availableQty}, Requested: ${returnQty}`,
    );
  }

  inventory.availableQty -= returnQty;
  inventory.totalStockamtDlp -= dlpbyPcs * returnQty;
  inventory.totalStockamtRlp -= rlpbyPcs * returnQty;

  inventory.availableQty = Math.max(0, inventory.availableQty);
  inventory.totalStockamtDlp = Math.max(0, inventory.totalStockamtDlp);
  inventory.totalStockamtRlp = Math.max(0, inventory.totalStockamtRlp);

  await inventory.save();

  const transaction = new Transaction({
    distributorId: purchaseReturn.distributorId,
    productId: product,
    invItemId: inventory._id,
    transactionId: stockId,
    qty: returnQty,
    date: new Date(),
    type: "Out",
    balanceCount: inventory.availableQty,
    description: `Purchase Return ${purchaseReturn.code} - Stock returned`,
    transactionType: "purchasereturn",
    stockType: "salable",
  });

  await transaction.save();

  return { success: true, inventory, transaction };
};

const processReturnRewardPoints = async (purchaseReturn) => {
  const invoice = await Invoice.findById(purchaseReturn.invoiceId);
  if (!invoice) {
    console.log(`Invoice not found for purchase return ${purchaseReturn.code}`);
    return;
  }

  const distributor = await Distributor.findById(
    purchaseReturn.distributorId,
  ).lean();
  if (!distributor) {
    console.log(
      `Distributor not found for ID: ${purchaseReturn.distributorId}`,
    );
    return;
  }

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

    const returnQuantity = qty;
    returnPoints += base_point * returnQuantity;
  }

  if (returnPoints > 0) {
    const latestTransaction = await DistributorTransaction.findOne({
      distributorId: purchaseReturn.distributorId,
    }).sort({ createdAt: -1 });

    const balance = latestTransaction
      ? Number(latestTransaction.balance) - Number(returnPoints)
      : 0;

    const newTransaction = new DistributorTransaction({
      distributorId: purchaseReturn.distributorId,
      transactionType: "debit",
      transactionFor: "Purchase Return",
      point: returnPoints,
      balance: Math.max(0, balance),
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

module.exports = { updatePurchaseReturn, approvePurchaseReturn };