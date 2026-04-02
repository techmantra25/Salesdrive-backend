const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Employee = require("../../models/employee.model");
const Beat = require("../../models/beat.model");
const OutletApproved = require("../../models/outletApproved.model");
const {
  generateCode,
  transactionCode,
  ledgerTransactionCode,
} = require("../../utils/codeGenerator");
const SalesReturnModel = require("../../models/salesReturn.model");
const Inventory = require("../../models/inventory.model");
const Product = require("../../models/product.model");
const Transaction = require("../../models/transaction.model");
const CreditNoteModel = require("../../models/creditNote.model");
const Price = require("../../models/price.model");
const Distributor = require("../../models/distributor.model");
const Replacement = require("../../models/replacement.model");
const Ledger = require("../../models/ledger.model");
const moment = require("moment-timezone");
const DistributorTransaction = require("../../models/distributorTransaction.model");
const axios = require("axios");
const RetailerMultiplierTransaction = require("../../models/retailerMultiplierTransaction.model");
const {
  RBP_POINT_BALANCE_CHECK_RETAILER,
  RBP_POINT_DEBIT_API,
} = require("../../config/retailerApp.config");

const { createStockLedgerEntry } = require("../../controllers/transction/createStockLedgerEntry")

const createSalesReturn = asyncHandler(async (req, res) => {
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

    const missingFields = [
      !billId && "billId",
      !salesmanName && "salesmanName",
      !routeId && "routeId",
      !retailerId && "retailerId",
      !goodsType && "goodsType",
    ].filter(Boolean);

    if (missingFields.length) {
      return res.status(400).json({
        status: 400,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const [bill, salesMan, beat, retailer] = await Promise.all([
      Bill.findById(billId),
      Employee.findById(salesmanName),
      Beat.findById(routeId),
      OutletApproved.findById(retailerId),
    ]);

    if (!bill)
      return res.status(404).json({ status: 404, message: "Bill not found" });
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

    // **NEW: Fetch distributor details to check RBP scheme mapping**
    const distributor = await Distributor.findById(req.user._id).lean();
    if (!distributor) {
      return res
        .status(404)
        .json({ status: 404, message: "Distributor not found" });
    }

    const salesReturnNo = await generateCode("SR");

    const billCreationDate = moment.tz(bill.createdAt, "Asia/Kolkata");
    const currentDate = moment.tz("Asia/Kolkata");

    // billCreationDate should be less than 90 days from currentDate

    const daysDiff = currentDate.diff(billCreationDate, "days");
    if (daysDiff > 90) {
      return res.status(400).json({
        status: 400,
        message: "Bill Creation date should be within 90 days from today",
      });
    }

    let storePoints = 0;

    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      try {
        const res = await axios.get(
          `${RBP_POINT_BALANCE_CHECK_RETAILER}?id=${retailerId}`,
        );
        const data = res.data;
        storePoints = Number(data?.balance) || 0;
      } catch (error) {
        res.status(400);
        throw new Error("Error fetching store points balance");
      }
    }

    let totalMultiplierPointsToDeduct = 0;
    // **CHANGED: Only calculate multiplier points if RBP scheme is mapped**
    if (distributor.RBPSchemeMapped === "yes") {
      const totalMultiplierPointsMetrics = await getMultiplierPointsToDeduct(
        bill,
        totalBasePoints,
      );

      if (
        totalMultiplierPointsMetrics.pointsToDeduct > 0 &&
        totalMultiplierPointsMetrics.percentage > 0
      ) {
        totalMultiplierPointsToDeduct =
          totalMultiplierPointsMetrics.pointsToDeduct;
      }
    }

    // **CHANGED: Only validate store points if RBP scheme is mapped**

    if (
      distributor.RBPSchemeMapped === "yes" &&
      totalBasePoints > 0 &&
      storePoints <
        Number(totalBasePoints) + Number(totalMultiplierPointsToDeduct)
    ) {
      return res.status(400).json({
        status: 400,
        message: `Insufficient store points. Available: ${storePoints}, Required: ${
          Number(totalBasePoints) + Number(totalMultiplierPointsToDeduct)
        }`,
      });
    }

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

    bill.salesReturnId.push(salesReturn._id);
    await bill.save();

    let transactions = [];
    let creditNoteItems = [];
    let replacementItems = [];

    for (const item of lineItems) {
      const inventory = await Inventory.findById(item.inventoryId);
      const stockId = await transactionCode("LXSTA");
      if (!inventory) {
        return res.status(404).json({
          status: 404,
          message: `Inventory item not found: ${item.inventoryId}`,
        });
      }

      const product = await Product.findById(item.product);
      const priceEntry = await Price.findById(item.price);
      const piecesPerBox =
        product?.uom === "box" ? product.no_of_pieces_in_a_box || 1 : 1;
      const rlpbyPcs = priceEntry?.rlp_price / piecesPerBox || 0;
      const dlpbyPcs = priceEntry?.dlp_price / piecesPerBox || 0;

      if (goodsType === "Salable") {
        inventory.availableQty =
          (inventory.availableQty || 0) + Number(item.returnQty);
        inventory.totalStockamtDlp += Math.round(
          dlpbyPcs * Number(item.returnQty),
        );
        inventory.totalStockamtRlp += Math.round(
          rlpbyPcs * Number(item.returnQty),
        );
      } else {
        inventory.unsalableQty =
          (inventory.unsalableQty || 0) + Number(item.returnQty);
        inventory.totalUnsalableamtDlp += Math.round(
          dlpbyPcs * Number(item.returnQty),
        );
        inventory.totalUnsalableStockamtRlp += Math.round(
          rlpbyPcs * Number(item.returnQty),
        );
      }

      inventory.totalQty =
        (inventory.availableQty || 0) + (inventory.unsalableQty || 0);
      await inventory.save();

      const transaction = await Transaction.create({
        distributorId: req.user._id,
        transactionId: stockId,
        invItemId: item.inventoryId,
        productId: inventory.productId,
        qty: item.returnQty,
        date: new Date(),
        type: "In",
        description: `Sales Return for ${salesReturnNo}`,
        balanceCount:
          goodsType === "Salable"
            ? inventory.availableQty
            : inventory.unsalableQty,
        transactionType: "salesreturn",
        stockType: goodsType === "Salable" ? "salable" : "unsalable",
      });
      transactions.push(transaction);

      try {
        await createStockLedgerEntry(transaction._id);
      } catch (ledgerError) {
        console.error(
          `Stock ledger creation failed for transaction ${stockId}:`,
          ledgerError.message,
        );
        // Don't fail the sales return, just log
      }

      if (item.salesReturnType === "Credit Note") {
        creditNoteItems.push({ ...item, adjustmentId: transaction._id });
      }

      if (item.salesReturnType === "Replacement") {
        replacementItems.push({ ...item, adjustmentId: transaction._id });
      }
    }

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
        billId: bill._id,
        lineItems: creditNoteItems,
        creditNoteNo,
        amount: Math.round(totalAmount),
        creditNoteCreationDate: new Date(),
        creditNoteStatus: "Pending",
        creditNoteRemark: salesReturn.remarks,
        creditNoteType: "With Reference",
      });

      // bill update with credit note
      await Bill.findByIdAndUpdate(
        { _id: bill._id },
        {
          $push: { creditNoteId: creditNote._id },
        },
        { new: true },
      );

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

    if (replacementItems.length) {
      const replacementNo = await generateCode("RPL");

      const replacement = await Replacement.create({
        distributorId: req.user._id,
        outletId: salesReturn.retailerId,
        salesReturnId: salesReturn._id,
        billId: bill._id,
        lineItems: replacementItems,
        replacementNo,
        replacementDate: new Date(),
        status: "Pending",
        remark: salesReturn.remarks,
        replacementType: "With Reference",
      });

      // bill update with replacement
      await Bill.findByIdAndUpdate(
        { _id: bill._id },
        {
          $push: { replacementId: replacement._id },
        },
        { new: true },
      );
    }

    /*-------- **CHANGED: RBP Point Transaction with scheme validation** ---------*/

    // **CHANGED: Only process base points if RBP scheme is mapped**

    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      console.log(
        `Processing base points for sales return - distributor ${distributor.dbCode} with RBP scheme mapped`,
      );
      const latestTransaction = await DistributorTransaction.findOne({
        distributorId: req.user._id,
      }).sort({ createdAt: -1 });

      let latestBalance = 0;
      if (latestTransaction) {
        latestBalance = latestTransaction?.balance;
      }

      const points = Number(totalBasePoints);

      const data = {
        distributorId: req.user._id,
        transactionType: "credit",
        transactionFor: "Sales Return",
        point: Number(points),
        balance: Number(latestBalance) + Number(points),
        salesReturnId: salesReturn._id,
        retailerId: bill.retailerId,
        status: "pending",
        remark: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
      };

      const body = {
        outlet_id: retailer.outletUID,
        amount: totalBasePoints,
        remarks: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
        type: "Sales Return",
        entry_date: moment(salesReturn.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_DEBIT_API, body);
        if (earnPointsResponse.data?.error) {
          data.status = "Failed";
          data.apiResponse = earnPointsResponse.data;
        } else {
          data.status = "Success";
        }
      } catch (err) {
        data.status = "Failed";
        data.apiResponse = {
          errorResponse: err?.response?.data,
        };
      }

      const newTransaction = new DistributorTransaction(data);
      await newTransaction.save();
      console.log(
        `Successfully created distributor transaction for ${points} base points for sales return`,
      );
    } else if (totalBasePoints > 0) {
      console.log(
        `Skipping base points processing - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`,
      );
    }

    // **CHANGED: Only process multiplier points if RBP scheme is mapped**
    if (
      totalMultiplierPointsToDeduct > 0 &&
      totalBasePoints > 0 &&
      distributor.RBPSchemeMapped === "yes"
    ) {
      console.log(
        `Processing multiplier points for sales return - distributor ${distributor.dbCode} with RBP scheme mapped`,
      );

      const billDeliveredDate = moment.tz(
        bill?.dates?.deliveryDate,
        "Asia/Kolkata",
      );
      const billDeliveredMonthInNumber = billDeliveredDate.month() + 1;
      const billDeliveredYear = billDeliveredDate.year();

      const data = {
        retailerId: salesReturn.retailerId,
        transactionType: "debit",
        transactionFor: "Sales Return",
        slabPercentage: totalMultiplierPointsMetrics?.percentage || 0,
        point: totalMultiplierPointsToDeduct,
        month: billDeliveredMonthInNumber,
        year: billDeliveredYear,
        status: "Pending",
        remark: `Multiplier Points deducted for Sales Return no ${salesReturnNo} on total points ${totalBasePoints} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
      };

      const body = {
        outlet_id: retailer.outletUID,
        amount: totalMultiplierPointsToDeduct,
        remarks: `Multiplier Points deducted for Sales Return no ${salesReturnNo} on total points ${totalBasePoints} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
        type: "Sales Multiplier",
        entry_date: moment(salesReturn.createdAt).format("YYYY-MM-DD"),
      };

      try {
        const earnPointsResponse = await axios.post(RBP_POINT_DEBIT_API, body);
        if (earnPointsResponse.data?.error) {
          data.status = "Failed";
          data.apiResponse = earnPointsResponse.data;
        } else {
          data.status = "Success";
        }
      } catch (err) {
        data.status = "Failed";
        data.apiResponse = {
          errorResponse: err?.response?.data,
        };
      }

      const retailerMultiplierTransaction = new RetailerMultiplierTransaction(
        data,
      );
      await retailerMultiplierTransaction.save();
      console.log(
        `Successfully created retailer multiplier transaction for ${totalMultiplierPointsToDeduct} multiplier points for sales return`,
      );
    } else if (totalMultiplierPointsToDeduct > 0) {
      console.log(
        `Skipping multiplier points processing - RBP scheme not mapped for distributor ${distributor.dbCode} (RBPSchemeMapped: ${distributor.RBPSchemeMapped})`,
      );
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

const getMultiplierPointsToDeduct = async (bill, totalBasePoints) => {
  let result = {
    pointsToDeduct: 0,
    percentage: 0,
  };

  const billDeliveredDate = moment.tz(
    bill?.dates?.deliveryDate,
    "Asia/Kolkata",
  );

  const billDeliveredMonth = billDeliveredDate.month() + 1; // month() is 0-based
  const billDeliveredYear = billDeliveredDate.year();

  const currentMonth = moment().month() + 1;
  const currentYear = moment().year();

  // If bill is from current month, no deduction
  if (
    billDeliveredMonth === currentMonth &&
    billDeliveredYear === currentYear
  ) {
    return result;
  }

  // Helper: fetch multipliers for a given month/year
  const fetchMultiplierPercentage = async (month, year) => {
    const multipliers =
      (await RetailerMultiplierTransaction.find({
        retailerId: bill.retailerId,
        transactionType: "credit",
        month,
        year,
      }).lean()) || [];

    return multipliers.reduce(
      (sum, item) => sum + (Number(item.slabPercentage) || 0),
      0,
    );
  };

  let highestPercentage = 0;

  // Start from current month
  const now = moment();

  for (let i = 1; i <= 3; i++) {
    // Subtract i months from current month
    const date = moment(now).subtract(i, "month");
    const month = date.month() + 1; // month() is 0-based
    const year = date.year();

    const percentage = await fetchMultiplierPercentage(month, year);

    if (percentage > highestPercentage) {
      highestPercentage = percentage;
    }
  }

  // Calculate points to deduct
  if (highestPercentage > 0 && totalBasePoints > 0) {
    result.pointsToDeduct = Math.round(
      (Number(totalBasePoints) * highestPercentage) / 100,
    );
    result.percentage = highestPercentage;
  }

  return result;
};

module.exports = { createSalesReturn };
