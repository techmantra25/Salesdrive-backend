// const asyncHandler = require("express-async-handler");
// const Bill = require("../../models/bill.model");
// const Employee = require("../../models/employee.model");
// const Beat = require("../../models/beat.model");
// const OutletApproved = require("../../models/outletApproved.model");
// const { generateCode, transactionCode } = require("../../utils/codeGenerator");
// const SalesReturnModel = require("../../models/salesReturn.model");
// const Inventory = require("../../models/inventory.model");
// const Product = require("../../models/product.model");
// const Price = require("../../models/price.model");
// const Transaction = require("../../models/transaction.model");
// const CreditNoteModel = require("../../models/creditNote.model");
// const Replacement = require("../../models/replacement.model");

// const createSalesReturnwithoutRef = asyncHandler(async (req, res) => {
//   try {
//     const {
//       billId,
//       salesmanName,
//       routeId,
//       retailerId,
//       goodsType,
//       collectionStatus,
//       remarks,
//       lineItems,
//       totalBasePoints,
//       grossAmount,
//       schemeDiscount,
//       distributorDiscount,
//       taxableAmount,
//       cgst,
//       sgst,
//       igst,
//       invoiceAmount,
//       roundOffAmount,
//       cashDiscount,
//       netAmount,
//     } = req.body;

//     let transactions = [];
//     const missingFields = [];
//     if (!salesmanName) missingFields.push("salesmanName");
//     if (!routeId) missingFields.push("routeId");
//     if (!retailerId) missingFields.push("retailerId");
//     if (!goodsType) missingFields.push("goodsType");

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         status: 400,
//         message: `Missing required fields: ${missingFields.join(", ")}`,
//       });
//     }

//     const salesReturnNo = await generateCode("SRNB");
//     const salesMan = await Employee.findById(salesmanName);

//     if (!salesMan) {
//       return res.status(404).json({
//         status: 404,
//         message: "Salesman not found",
//       });
//     }

//     const beat = await Beat.findById(routeId);

//     if (!beat) {
//       return res.status(404).json({
//         status: 404,
//         message: "Beat not found",
//       });
//     }

//     const retailer = await OutletApproved.findById(retailerId);

//     if (!retailer) {
//       return res.status(404).json({
//         status: 404,
//         message: "Retailer not found",
//       });
//     }

//     const salesReturnData = new SalesReturnModel({
//       distributorId: req.user._id,
//       salesReturnNo: salesReturnNo,
//       billId,
//       salesmanName,
//       routeId,
//       retailerId,
//       goodsType,
//       collectionStatus,
//       remarks,
//       lineItems,
//       totalBasePoints,
//       grossAmount,
//       schemeDiscount,
//       distributorDiscount,
//       taxableAmount,
//       cgst,
//       sgst,
//       igst,
//       invoiceAmount,
//       roundOffAmount,
//       cashDiscount,
//       netAmount,
//     });

//     const salesReturn = await salesReturnData.save();

//     for (const item of lineItems) {
//       const stockId = await transactionCode("LXSTA");

//       const inventory = await Inventory.findById(item.inventoryId);

//       if (!inventory) {
//         return res.status(404).json({
//           status: 404,
//           message: `Inventory item not found: ${item.inventoryId}`,
//         });
//       }

//       const product = await Product.findById(item.product);
//       const priceEntry = await Price.findOne({ _id: item.price });

//       let rlpbyPcs = 0;
//       let dlpbyPcs = 0;

//       if (product?.uom === "box") {
//         const piecesPerBox = product?.no_of_pieces_in_a_box || 1;
//         rlpbyPcs = priceEntry?.rlp_price / piecesPerBox;
//         dlpbyPcs = priceEntry?.dlp_price / piecesPerBox;
//       } else {
//         rlpbyPcs = priceEntry?.rlp_price || 0;
//         dlpbyPcs = priceEntry?.dlp_price || 0;
//       }

//       // Manually update inventory fields
//       if (goodsType == "Salable") {
//         inventory.availableQty =
//           (inventory.availableQty ?? 0) + Number(item.returnQty);
//         inventory.totalStockamtDlp = Math.round(
//           (inventory.totalStockamtDlp ?? 0) + dlpbyPcs * Number(item.returnQty)
//         );
//         inventory.totalStockamtRlp = Math.round(
//           (inventory.totalStockamtRlp ?? 0) + rlpbyPcs * Number(item.returnQty)
//         );
//       } else {
//         inventory.unsalableQty =
//           (inventory.unsalableQty ?? 0) + Number(item.returnQty);
//         inventory.totalUnsalableamtDlp = Math.round(
//           (inventory.totalUnsalableamtDlp ?? 0) +
//             dlpbyPcs * Number(item.returnQty)
//         );
//         inventory.totalUnsalableStockamtRlp = Math.round(
//           (inventory.totalUnsalableStockamtRlp ?? 0) +
//             rlpbyPcs * Number(item.returnQty)
//         );
//       }

//       // Update total quantity
//       inventory.totalQty =
//         (inventory.availableQty ?? 0) + (inventory.unsalableQty ?? 0);

//       // Save updated inventory
//       await inventory.save();

//       // Log transaction
//       transactions.push({
//         distributorId: req.user._id,
//         transactionId: stockId,
//         invItemId: item.inventoryId,
//         productId: inventory?.productId,
//         qty: item.returnQty,
//         date: new Date(),
//         type: "In",
//         description: `Without reference sales return`,
//         balanceCount:
//           item.goodsType === "Salable"
//             ? inventory.availableQty
//             : inventory.unsalableQty,
//         transactionType: "salesreturn",
//         stockType: goodsType == "Salable" ? "salable" : "unsalable",
//       });
//     }

//     // Save transactions in bulk
//     if (transactions.length > 0) {
//       await Transaction.insertMany(transactions);
//     }

//     res.status(201).json({
//       status: 201,
//       message: "Sales return created successfully",
//       data: salesReturn,
//     });
//   } catch (error) {
//     res.status(500);
//     throw error;
//   }
// });

// module.exports = { createSalesReturnwithoutRef };

const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Employee = require("../../models/employee.model");
const Beat = require("../../models/beat.model");
const OutletApproved = require("../../models/outletApproved.model");
const {
  generateCode,
  transactionCode,
  ledgerTransactionCode,
  generateCodeForSalesReturn,
} = require("../../utils/codeGenerator");
const SalesReturnModel = require("../../models/salesReturn.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Transaction = require("../../models/transaction.model");
const CreditNoteModel = require("../../models/creditNote.model");
const Replacement = require("../../models/replacement.model");
const Ledger = require("../../models/ledger.model");
const {
  createStockLedgerEntry,
} = require("../../controllers/transction/createStockLedgerEntry");
const Distributor = require("../../models/distributor.model");

const createSalesReturnwithoutRef = asyncHandler(async (req, res) => {
  try {
    const {
      billId,
      salesmanName,
      routeId,
      retailerId,
      goodsType,
      collectionStatus,
      remarks,
      lineItems,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
    } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!salesmanName) missingFields.push("salesmanName");
    if (!routeId) missingFields.push("routeId");
    if (!retailerId) missingFields.push("retailerId");
    if (!goodsType) missingFields.push("goodsType");

    if (missingFields.length) {
      return res.status(400).json({
        status: 400,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const distributor = await Distributor.findById(req.user._id).lean();
    if (!distributor) {
      return res
        .status(404)
        .json({ status: 404, message: "Distributor not found" });
    }

    // Generate Sales Return Number
    //const salesReturnNo = await generateCode("SRNB");

    const salesReturnNo = await generateCodeForSalesReturn(
      "SRNB",
      distributor._id,
    );

    // Fetch related data
    const [salesMan, beat, retailer] = await Promise.all([
      Employee.findById(salesmanName),
      Beat.findById(routeId),
      OutletApproved.findById(retailerId),
    ]);

    if (!salesMan)
      return res
        .status(404)
        .json({ status: 404, message: "Salesman not found" });
    if (!beat)
      return res.status(404).json({ status: 404, message: "Beat not found" });
    if (!retailer)
      return res
        .status(404)
        .json({ status: 404, message: "Retailer not found" });

    // Create Sales Return Entry
    const salesReturn = await SalesReturnModel.create({
      distributorId: req.user._id,
      salesReturnNo,
      billId,
      salesmanName,
      routeId,
      retailerId,
      goodsType,
      collectionStatus,
      remarks,
      lineItems,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
    });

    let transactions = [];
    let creditNoteItems = [];
    let replacementItems = [];

    for (const item of lineItems) {
      const stockId = await transactionCode("LXSTA");

      const inventory = await Inventory.findById(item.inventoryId);
      if (!inventory) {
        return res.status(404).json({
          status: 404,
          message: `Inventory item not found: ${item.inventoryId}`,
        });
      }

      const product = await Product.findById(item.product);
      const priceEntry = await Price.findById(item.price);

      let rlpbyPcs =
        product?.uom === "box"
          ? (priceEntry?.rlp_price || 0) / (product?.no_of_pieces_in_a_box || 1)
          : priceEntry?.rlp_price || 0;

      let dlpbyPcs =
        product?.uom === "box"
          ? (priceEntry?.dlp_price || 0) / (product?.no_of_pieces_in_a_box || 1)
          : priceEntry?.dlp_price || 0;

      // Update Inventory Based on Goods Type
      if (goodsType === "Salable") {
        inventory.availableQty += Number(item.returnQty);
        inventory.totalStockamtDlp += Math.round(
          dlpbyPcs * Number(item.returnQty),
        );
        inventory.totalStockamtRlp += Math.round(
          rlpbyPcs * Number(item.returnQty),
        );
      } else {
        inventory.unsalableQty += Number(item.returnQty);
        inventory.totalUnsalableamtDlp += Math.round(
          dlpbyPcs * Number(item.returnQty),
        );
        inventory.totalUnsalableStockamtRlp += Math.round(
          rlpbyPcs * Number(item.returnQty),
        );
      }

      inventory.totalQty = inventory.availableQty + inventory.unsalableQty;
      await inventory.save();

      // const newTransaction = await Transaction.create({
      //   distributorId: req.user._id,
      //   transactionId: stockId,
      //   invItemId: item.inventoryId,
      //   productId: inventory?.productId,
      //   qty: item.returnQty,
      //   date: new Date(),
      //   type: "In",
      //   description: "Without reference sales return",
      //   balanceCount:
      //     goodsType === "Salable"
      //       ? inventory.availableQty
      //       : inventory.unsalableQty,
      //   transactionType: "salesreturn",
      //   stockType: goodsType === "Salable" ? "salable" : "unsalable",
      // });

      const newTransaction = await Transaction.create({
        distributorId: req.user._id,
        transactionId: stockId,
        invItemId: item.inventoryId,
        productId: inventory?.productId,
        qty: item.returnQty,
        date: new Date(),
        type: "In",
        description: "Without reference sales return",
        balanceCount:
          goodsType === "Salable"
            ? inventory.availableQty
            : inventory.unsalableQty,
        transactionType: "salesreturn",
        stockType: goodsType === "Salable" ? "salable" : "unsalable",
      });

      // Create stock ledger entry for sales return without reference
      try {
        await createStockLedgerEntry(newTransaction._id);
      } catch (error) {
        console.error(
          `Stock ledger creation failed for transaction ${newTransaction._id}:`,
          error.message,
        );
        // Don't throw - allow sales return to continue
      }

      // Categorize Sales Return Items
      if (item.salesReturnType === "Credit Note") {
        creditNoteItems.push({ ...item, adjustmentId: newTransaction._id });
      } else if (item.salesReturnType === "Replacement") {
        replacementItems.push({ ...item, adjustmentId: newTransaction._id });
      }
    }

    // **Credit Note Logic**
    if (creditNoteItems.length) {
      const totalAmount = creditNoteItems.reduce(
        (sum, item) => sum + (Number(item.netAmt) || 0),
        0,
      );
      const creditNoteNo = await generateCode("CN");

      const creditNote = await CreditNoteModel.create({
        distributorId: req.user._id,
        outletId: salesReturn.retailerId,
        salesReturnId: salesReturn._id,
        billId,
        lineItems: creditNoteItems,
        creditNoteNo,
        amount: Math.round(totalAmount),
        creditNoteCreationDate: new Date(),
        creditNoteStatus: "Pending",
        creditNoteRemark: salesReturn.remarks,
        creditNoteType: "Without Reference",
      });

      await Bill.findByIdAndUpdate(billId, {
        $push: { creditNoteId: creditNote._id },
      });

      // TODO: Add a debit transaction for the ledger
      await new Promise((resolve) => setTimeout(resolve, 200));

      const latestLedger = await Ledger.findOne({
        dbId: req.user._id,
        retailerId: salesReturn.retailerId,
      }).sort({ createdAt: -1 });

      let latestLedgerBalance = 0;
      if (latestLedger) {
        latestLedgerBalance = latestLedger?.balance;
      }

      const transactionId = await ledgerTransactionCode("LEDG", req.user._id);

      await Ledger.create({
        dbId: req.user._id,
        retailerId: salesReturn.retailerId,
        transactionId,
        transactionType: "debit",
        transactionFor: "Credit Note",
        creditNoteId: creditNote?._id,
        transactionAmount: Math.round(totalAmount),
        balance: (
          Number(latestLedgerBalance) - Math.round(totalAmount)
        ).toFixed(2),
      });
    }

    // **Replacement Logic**
    if (replacementItems.length) {
      const replacementNo = await generateCode("RPL");

      const replacement = await Replacement.create({
        distributorId: req.user._id,
        outletId: salesReturn.retailerId,
        salesReturnId: salesReturn._id,
        billId,
        lineItems: replacementItems,
        replacementNo,
        replacementDate: new Date(),
        status: "Pending",
        remark: salesReturn.remarks,
        replacementType: "Without Reference",
      });

      await Bill.findByIdAndUpdate(billId, {
        $push: { replacementId: replacement._id },
      });
    }

    res.status(201).json({
      status: 201,
      message: "Sales return created successfully",
      data: salesReturn,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createSalesReturnwithoutRef };
