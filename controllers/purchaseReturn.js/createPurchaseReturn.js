const asyncHandler = require("express-async-handler");
const PurchaseReturn = require("../../models/purchaseReturn.model");
const Invoice = require("../../models/invoice.model");
const { generatePurchaseReturnCode } = require("../../utils/codeGenerator");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const Distributor = require("../../models/distributor.model");
const PriamaryTarget = require("../../models/primaryTarget.model");
const Product = require("../../models/product.model");

const createPurchaseReturn = asyncHandler(async (req, res) => {
  try {
    const distributorId = req?.user?._id;

    const invoiceId = req.body.invoiceId;

    const invoice = await Invoice.findById(invoiceId);
    if (invoice && invoice.distributorId.toString() !== distributorId.toString()) {
      res.status(403);
      throw new Error("Unauthorized invoice access");
    }

    // res.status(404);
    // throw new Error("Invoice not found");

    if (!invoice) {
      res.status(404);
      throw new Error("Invoice not found");
    }

    // **NEW: Fetch distributor details to check RBP scheme mapping**
    const distributor = await Distributor.findById(distributorId).lean();
    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    const totalBasePoints = req.body.totalBasePoints || 0;

    // **CHANGED: Only validate points balance if RBP scheme is mapped and points > 0**
    let currentBalance = 0;

    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      console.log(
        `Checking point balance for purchase return - distributor ${distributor.dbCode} with RBP scheme mapped`
      );

      const latestDbTransaction = await DistributorTransaction.findOne({
        distributorId,
      }).sort({ createdAt: -1 });

      currentBalance = Number(latestDbTransaction?.balance) || 0;

      if (currentBalance < totalBasePoints) {
        res.status(400);
        throw new Error(
          `Insufficient point balance for purchase return. ${currentBalance} points available, ${totalBasePoints} points required.`
        );
      }
    } else if (totalBasePoints > 0) {
      console.log(
        `Skipping point balance validation - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`
      );
    }

    // create purchase return
    const purchaseReturn = await PurchaseReturn.create({
      ...req.body,
      distributorId,
      code: await generatePurchaseReturnCode("INV-RET"),
    });

    if (!purchaseReturn) {
      res.status(400);
      throw new Error("Purchase return creation failed");
    }

    // update the invoice with the purchase return
    invoice.purchaseReturnIds = [
      ...(invoice.purchaseReturnIds || []),
      purchaseReturn._id,
    ];
    const updatedInvoice = await invoice.save();

    // ================= TARGET ACHIEVEMENT REVERSAL START =================

    if (invoice.targetIds && invoice.targetIds.length > 0) {
      console.log("🎯 Reversing target achievement due to purchase return");

      // fetch products
      const productIds = purchaseReturn.lineItems.map(i => i.product);

      const products = await Product.find({
        _id: { $in: productIds }``
      }).lean();

      const productMap = {};
      products.forEach(p => {
        productMap[p._id.toString()] = p;
      });

      // loop targets
      for (const targetId of invoice.targetIds) {
        const target = await PriamaryTarget.findById(targetId);
        if (!target) continue;

        // ✅ date validation
        const invoiceDate = new Date(invoice.date);
        if (
          invoiceDate < new Date(target.target_start_date) ||
          invoiceDate > new Date(target.target_end_date)
        ) {
          continue;
        }

        let deductionAmount = 0;

        for (const item of purchaseReturn.lineItems) {
          const product = productMap[item.product.toString()];
          if (!product) continue;

          const isBrandMatch =
            !target.brandId?.length ||
            target.brandId.some(
              id => id.toString() === product.brandId?.toString()
            );

          const isSubBrandMatch =
            !target.subBrandId?.length ||
            target.subBrandId.some(
              id => id.toString() === product.subBrandId?.toString()
            );

          if (!isBrandMatch || !isSubBrandMatch) continue;

          // 🔥 MATCH WITH INVOICE ITEM (IMPORTANT FIX)
          const invoiceItem = invoice.lineItems.find(
            invItem =>
              invItem.product.toString() === item.product.toString()
          );

          if (!invoiceItem) continue;

          const ratio = item.qty / invoiceItem.qty;

          const valueToDeduct =
            Number(invoiceItem.netAmount || 0) * ratio;

          deductionAmount += valueToDeduct;
        }

        if (deductionAmount > 0) {
          console.log(
            `Reducing ${deductionAmount} from target ${target.name}`
          );

          target.achivedTarget =
            Number(target.achivedTarget || 0) - deductionAmount;

          if (target.achivedTarget < 0) {
            target.achivedTarget = 0;
          }

          await target.save();
        }
      }
    }

    // ================= TARGET ACHIEVEMENT REVERSAL END =================

    // **COMMENTED OUT: Distributor transaction now happens only after return approval in updatePurchaseReturn.js**
    /*
    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      console.log(
        `Creating distributor transaction for ${totalBasePoints} points for purchase return - distributor ${distributor.dbCode}`
      );
      // record a debit transaction for the distributor
      const data = {
        distributorId,
        transactionType: "debit",
        transactionFor: "Purchase Return",
        point: Number(totalBasePoints),
        balance: Number(currentBalance) - Number(totalBasePoints),
        status: "Success",
        purchaseReturnId: purchaseReturn._id,
        remark: `Points deducting for purchase return with code ${purchaseReturn.code} for DB Code ${distributor.dbCode}`,
      };

      await DistributorTransaction.create(data);
      console.log(
        `Successfully created distributor transaction: debit ${totalBasePoints} points for purchase return`
      );
    } else if (totalBasePoints > 0) {
      console.log(
        `Skipping distributor transaction creation - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`
      );
    }
    */

    res.status(201).json({
      error: false,
      message: "Purchase return created successfully",
      data: purchaseReturn,
      invoice: updatedInvoice,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { createPurchaseReturn };
