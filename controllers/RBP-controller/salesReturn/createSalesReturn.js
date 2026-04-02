const asyncHandler = require("express-async-handler");
const Bill = require("../../../models/bill.model");
const Employee = require("../../../models/employee.model");
const Beat = require("../../../models/beat.model");
const OutletApproved = require("../../../models/outletApproved.model");
const {
  generateCode,
  transactionCode,
  ledgerTransactionCode,
  retailerOutletTransactionCode,
  generateCodeForSalesReturn,
} = require("../../../utils/codeGenerator");
const SalesReturnModel = require("../../../models/salesReturn.model");
const Inventory = require("../../../models/inventory.model");
const Product = require("../../../models/product.model");
const Transaction = require("../../../models/transaction.model");
const CreditNoteModel = require("../../../models/creditNote.model");
const Price = require("../../../models/price.model");
const Distributor = require("../../../models/distributor.model");
const Replacement = require("../../../models/replacement.model");
const Ledger = require("../../../models/ledger.model");
const BillDeliverySetting = require("../../../models/billDeliverySetting.model");
const moment = require("moment-timezone");
const DistributorTransaction = require("../../../models/distributorTransaction.model");
const RetailerMultiplierTransaction = require("../../../models/retailerMultiplierTransaction.model");
const RetailerOutletTransaction = require("../../../models/retailerOutletTransaction.model");
const {
  createStockLedgerEntry,
} = require("../../../controllers/transction/createStockLedgerEntry");
const { calculateBackdateFields } = require("../../../utils/backdateHelper");
const {
  updateSecondaryTargetOnSalesReturn,
} = require("./util/updateSecondaryTargetOnSalesReturn");

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

    //const salesReturnNo = await generateCode("SR");

    const salesReturnNo = await generateCodeForSalesReturn(
      "SR",
      distributor._id,
    );

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

    // Calculate backdate fields for sales return
    // If bill was created in previous month and we're returning it in next month (before cron runs),
    // AND enableBackdateBilling is YES, we need to backdate the return to the last day of the billing month
    // Query without isActive filter to allow backdate billing to work independently
    const deliverySetting = await BillDeliverySetting.findOne({
      distributorId: distributor._id,
    });
    const enableBackdateBilling =
      deliverySetting?.enableBackdateBilling === true;

    const actualReturnDate = new Date();
    const backdateFields = calculateBackdateFields(
      bill.createdAt,
      actualReturnDate,
      enableBackdateBilling,
    );

    if (backdateFields.enabledBackDate) {
      console.log(
        `Backdate logic applied for sales return ${bill.billNo}: Real return date=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Backdated to=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
      );
    }

    let storePoints = 0;

    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      const lastRetailerTxn = await RetailerOutletTransaction.findOne({
        retailerId: retailerId,
      }).sort({ createdAt: -1 });
      if (lastRetailerTxn) {
        storePoints = Number(lastRetailerTxn.balance) || 0;
      } else {
        storePoints = Number(retailer.currentPointBalance) || 0;
      }
    }

    let totalMultiplierPointsToDeduct = 0;
    let totalMultiplierPointsMetrics = null;

    if (distributor.RBPSchemeMapped === "yes") {
      // **OLD CALL - COMMENTED OUT**
      // totalMultiplierPointsMetrics = await getMultiplierPointsToDeduct(
      //   bill,
      //   totalBasePoints,
      // );

      // **NEW CALL - Pass the backdated sales return date**
      totalMultiplierPointsMetrics = await getMultiplierPointsToDeduct(
        bill,
        totalBasePoints,
        backdateFields.deliveryDate, // Pass the backdated sales return date
        backdateFields.enabledBackDate, // If backdate is enabled, skip multiplier deduction
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

    // **OLD SALES RETURN CREATION - COMMENTED OUT**
    // const salesReturn = await SalesReturnModel.create({
    //   distributorId: req.user._id,
    //   salesReturnNo,
    //   billId,
    //   salesmanName,
    //   routeId,
    //   retailerId,
    //   goodsType,
    //   collectionStatus,
    //   remarks,
    //   lineItems,
    //   totalBasePoints,
    //   grossAmount,
    //   schemeDiscount,
    //   distributorDiscount,
    //   taxableAmount,
    //   cgst,
    //   sgst,
    //   igst,
    //   invoiceAmount,
    //   roundOffAmount,
    //   cashDiscount,
    //   netAmount,
    // });

    // **NEW SALES RETURN CREATION - With backdate fields**
    const salesReturnData = {
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
      salesReturnDate: backdateFields.deliveryDate, // Use backdated date for multiplier calculations
      originalSalesReturnDate: backdateFields.originalDeliveryDate, // Store actual return date
      enabledBackDate: backdateFields.enabledBackDate, // Flag indicating if backdate is applied
    };

    // Explicitly set timestamps for backdate
    if (backdateFields.deliveryDate) {
      salesReturnData.createdAt = backdateFields.deliveryDate;
      salesReturnData.updatedAt = backdateFields.deliveryDate;
    }

    const salesReturn = await SalesReturnModel.create(salesReturnData);

    // Update secondary target achievement for this sales return
    await updateSecondaryTargetOnSalesReturn(salesReturn);

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

      // const transaction = await Transaction.create({
      //   distributorId: req.user._id,
      //   transactionId: stockId,
      //   invItemId: item.inventoryId,
      //   productId: inventory.productId,
      //   qty: item.returnQty,
      //   date: new Date(),
      //   type: "In",
      //   description: `Sales Return for ${salesReturnNo}`,
      //   balanceCount:
      //     goodsType === "Salable"
      //       ? inventory.availableQty
      //       : inventory.unsalableQty,
      //   transactionType: "salesreturn",
      //   stockType: goodsType === "Salable" ? "salable" : "unsalable",
      // });
      // transactions.push(transaction);

      const transactionData = {
        distributorId: req.user._id,
        transactionId: stockId,
        invItemId: item.inventoryId,
        productId: inventory.productId,
        billId: bill._id,
        billLineItemId: item._id,
        qty: item.returnQty,
        date: backdateFields.deliveryDate || new Date(),
        type: "In",
        description: `Sales Return for ${salesReturnNo}`,
        balanceCount:
          goodsType === "Salable"
            ? inventory.availableQty
            : inventory.unsalableQty,
        transactionType: "salesreturn",
        stockType: goodsType === "Salable" ? "salable" : "unsalable",
        dates: {
          deliveryDate: backdateFields.deliveryDate,
          originalDeliveryDate: backdateFields.originalDeliveryDate,
        },
        enabledBackDate: backdateFields.enabledBackDate,
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        transactionData.createdAt = backdateFields.deliveryDate;
        transactionData.updatedAt = backdateFields.deliveryDate;
      }

      const transaction = await Transaction.create(transactionData);

      // Create stock ledger entry for sales return
      try {
        await createStockLedgerEntry(transaction._id);
      } catch (error) {
        console.error(
          `Stock ledger creation failed for transaction ${transaction._id}:`,
          error.message,
        );
        // Don't throw - allow sales return to continue
      }

      transactions.push(transaction);

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

      const creditNoteData = {
        distributorId: req.user._id,
        outletId: salesReturn.retailerId,
        salesReturnId: salesReturn._id,
        billId: bill._id,
        lineItems: creditNoteItems,
        creditNoteNo,
        amount: Math.round(totalAmount),
        creditNoteCreationDate: backdateFields.deliveryDate || new Date(),
        creditNoteStatus: "Pending",
        creditNoteRemark: salesReturn.remarks,
        creditNoteType: "With Reference",
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        creditNoteData.createdAt = backdateFields.deliveryDate;
        creditNoteData.updatedAt = backdateFields.deliveryDate;
      }

      const creditNote = await CreditNoteModel.create(creditNoteData);

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

      const ledgerCreditNoteData = {
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
        date: backdateFields.deliveryDate || new Date(),
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        ledgerCreditNoteData.createdAt = backdateFields.deliveryDate;
        ledgerCreditNoteData.updatedAt = backdateFields.deliveryDate;
      }

      await Ledger.create(ledgerCreditNoteData);
    }

    if (replacementItems.length) {
      const replacementNo = await generateCode("RPL");

      const replacementData = {
        distributorId: req.user._id,
        outletId: salesReturn.retailerId,
        salesReturnId: salesReturn._id,
        billId: bill._id,
        lineItems: replacementItems,
        replacementNo,
        replacementDate: backdateFields.deliveryDate || new Date(),
        status: "Pending",
        remark: salesReturn.remarks,
        replacementType: "With Reference",
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        replacementData.createdAt = backdateFields.deliveryDate;
        replacementData.updatedAt = backdateFields.deliveryDate;
      }

      const replacement = await Replacement.create(replacementData);

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

      // Distributor side: credit points back
      const lastDistributorTxn = await DistributorTransaction.findOne({
        distributorId: req.user._id,
      }).sort({ createdAt: -1 });

      const distributorPrevBalance = lastDistributorTxn
        ? Number(lastDistributorTxn.balance)
        : 0;

      const points = Number(totalBasePoints);

      // **OLD TRANSACTION CREATION - COMMENTED OUT**
      // const distributorTxn = await DistributorTransaction.create({
      //   distributorId: req.user._id,
      //   transactionType: "credit",
      //   transactionFor: "Sales Return",
      //   point: points,
      //   balance: distributorPrevBalance + points,
      //   salesReturnId: salesReturn._id,
      //   retailerId: bill.retailerId,
      //   status: "Success",
      //   remark: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
      // });

      // **NEW TRANSACTION CREATION - With enabledBackDate field**
      const distributorTxnData = {
        distributorId: req.user._id,
        transactionType: "credit",
        transactionFor: "Sales Return",
        point: points,
        balance: distributorPrevBalance + points,
        salesReturnId: salesReturn._id,
        retailerId: bill.retailerId,
        status: "Success",
        remark: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
        dates: {
          deliveryDate: backdateFields.deliveryDate,
          originalDeliveryDate: backdateFields.originalDeliveryDate,
        },
        enabledBackDate: backdateFields.enabledBackDate,
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        distributorTxnData.createdAt = backdateFields.deliveryDate;
        distributorTxnData.updatedAt = backdateFields.deliveryDate;
      }

      const distributorTxn =
        await DistributorTransaction.create(distributorTxnData);

      // Retailer side: debit points
      const lastRetailerTxn2 = await RetailerOutletTransaction.findOne({
        retailerId: salesReturn.retailerId,
      }).sort({ createdAt: -1 });

      const retailerPrevBalance = lastRetailerTxn2
        ? Number(lastRetailerTxn2.balance)
        : Number(retailer.currentPointBalance) || 0;

      // **OLD TRANSACTION CREATION - COMMENTED OUT**
      // const retailerOutletTxnSR = await RetailerOutletTransaction.create({
      //   retailerId: salesReturn.retailerId,
      //   distributorId: req.user._id,
      //   salesReturnId: salesReturn._id,
      //   billId: bill._id,
      //   distributorTransactionId: distributorTxn._id,
      //   transactionId: await retailerOutletTransactionCode("RTO"),
      //   transactionType: "debit",
      //   transactionFor: "Sales Return",
      //   point: points,
      //   balance: retailerPrevBalance - points,
      //   status: "Success",
      //   remark: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
      // });

      // **NEW TRANSACTION CREATION - With enabledBackDate field**
      const retailerOutletTxnSRData = {
        retailerId: salesReturn.retailerId,
        distributorId: req.user._id,
        salesReturnId: salesReturn._id,
        billId: bill._id,
        distributorTransactionId: distributorTxn._id,
        transactionId: await retailerOutletTransactionCode("RTO"),
        transactionType: "debit",
        transactionFor: "Sales Return",
        point: points,
        balance: retailerPrevBalance - points,
        status: "Success",
        remark: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
        dates: {
          deliveryDate: backdateFields.deliveryDate,
          originalDeliveryDate: backdateFields.originalDeliveryDate,
        },
        enabledBackDate: backdateFields.enabledBackDate,
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        retailerOutletTxnSRData.createdAt = backdateFields.deliveryDate;
        retailerOutletTxnSRData.updatedAt = backdateFields.deliveryDate;
      }

      const retailerOutletTxnSR = await RetailerOutletTransaction.create(
        retailerOutletTxnSRData,
      );

      // Link back to distributor transaction
      await DistributorTransaction.updateOne(
        { _id: distributorTxn._id },
        { $set: { retailerOutletTransactionId: retailerOutletTxnSR._id } },
      );

      // Update retailer snapshot balance (UI only)
      await OutletApproved.updateOne(
        { _id: salesReturn.retailerId },
        { $inc: { currentPointBalance: -points } },
      );

      console.log(
        `Successfully recorded base point debit of ${points} for sales return and credited distributor ledger`,
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

      // **OLD LOGIC - COMMENTED OUT**
      // const billDeliveredDate = moment.tz(
      //   bill?.dates?.deliveryDate,
      //   "Asia/Kolkata",
      // );
      // const billDeliveredMonthInNumber = billDeliveredDate.month() + 1;
      // const billDeliveredYear = billDeliveredDate.year();

      // **NEW LOGIC - Use backdated sales return date for month/year determination**
      const salesReturnDateForCalculation = moment.tz(
        salesReturn.salesReturnDate,
        "Asia/Kolkata",
      );
      const salesReturnMonthInNumber =
        salesReturnDateForCalculation.month() + 1;
      const salesReturnYear = salesReturnDateForCalculation.year();

      console.log(
        `Using sales return date for multiplier calculation: ${salesReturnDateForCalculation.format("YYYY-MM-DD")} (Month: ${salesReturnMonthInNumber}, Year: ${salesReturnYear})`,
      );

      // Record multiplier ledger for retailer
      const lastRetailerTxn3 = await RetailerOutletTransaction.findOne({
        retailerId: salesReturn.retailerId,
      }).sort({ createdAt: -1 });

      const retailerPrevBalance2 = lastRetailerTxn3
        ? Number(lastRetailerTxn3.balance)
        : Number(retailer.currentPointBalance) || 0;

      // **OLD TRANSACTION CREATION - COMMENTED OUT**
      // const retailerOutletTxnSM = await RetailerOutletTransaction.create({
      //   retailerId: salesReturn.retailerId,
      //   distributorId: req.user._id,
      //   salesReturnId: salesReturn._id,
      //   billId: bill._id,
      //   transactionId: await retailerOutletTransactionCode("RTO"),
      //   transactionType: "debit",
      //   transactionFor: "Sales Multiplier",
      //   point: totalMultiplierPointsToDeduct,
      //   balance: retailerPrevBalance2 - totalMultiplierPointsToDeduct,
      //   status: "Success",
      //   remark: `Multiplier Points deducted for Sales Return no ${salesReturnNo} on total points ${totalBasePoints}`,
      // });

      // **NEW TRANSACTION CREATION - With enabledBackDate field**
      const retailerOutletTxnSMData = {
        retailerId: salesReturn.retailerId,
        distributorId: req.user._id,
        salesReturnId: salesReturn._id,
        billId: bill._id,
        transactionId: await retailerOutletTransactionCode("RTO"),
        transactionType: "debit",
        transactionFor: "Multiplier Sales Return",
        point: totalMultiplierPointsToDeduct,
        balance: retailerPrevBalance2 - totalMultiplierPointsToDeduct,
        status: "Success",
        remark: `Multiplier Points deducted for Sales Return no ${salesReturnNo} on total points ${totalBasePoints}`,
        dates: {
          deliveryDate: backdateFields.deliveryDate,
          originalDeliveryDate: backdateFields.originalDeliveryDate,
        },
        enabledBackDate: backdateFields.enabledBackDate,
      };

      // Explicitly set timestamps for backdate
      if (backdateFields.deliveryDate) {
        retailerOutletTxnSMData.createdAt = backdateFields.deliveryDate;
        retailerOutletTxnSMData.updatedAt = backdateFields.deliveryDate;
      }

      const retailerOutletTxnSM = await RetailerOutletTransaction.create(
        retailerOutletTxnSMData,
      );

      // Update retailer snapshot balance (UI only)
      await OutletApproved.updateOne(
        { _id: salesReturn.retailerId },
        { $inc: { currentPointBalance: -totalMultiplierPointsToDeduct } },
      );

      // Record multiplier meta transaction
      await new RetailerMultiplierTransaction({
        retailerId: salesReturn.retailerId,
        retailerOutletTransactionId: retailerOutletTxnSM._id,
        transactionType: "debit",
        transactionFor: "Sales Return",
        slabPercentage: totalMultiplierPointsMetrics?.percentage || 0,
        point: totalMultiplierPointsToDeduct,
        month: salesReturnMonthInNumber,
        year: salesReturnYear,
        status: "Success",
        remark: `Multiplier Points deducted for Sales Return no ${salesReturnNo} on total points ${totalBasePoints} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
      }).save();

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

// **FUNCTION SIGNATURE CHANGED**
// OLD: const getMultiplierPointsToDeduct = async (bill, totalBasePoints) => {
// NEW: Added salesReturnDate parameter to use backdated return date instead of bill delivery date
const getMultiplierPointsToDeduct = async (
  bill,
  totalBasePoints,
  salesReturnDate,
  enabledBackDate = false,
) => {
  let result = {
    pointsToDeduct: 0,
    percentage: 0,
  };

  // If sales return is backdated, multiplier must not be deducted.
  if (enabledBackDate) {
    return result;
  }

  // **OLD LOGIC - COMMENTED OUT**
  // const billDeliveredDate = moment.tz(
  //   bill?.dates?.deliveryDate,
  //   "Asia/Kolkata",
  // );
  // const billDeliveredMonth = billDeliveredDate.month() + 1; // month() is 0-based
  // const billDeliveredYear = billDeliveredDate.year();
  // // If bill is from current month, no deduction
  // if (
  //   billDeliveredMonth === currentMonth &&
  //   billDeliveredYear === currentYear
  // ) {
  //   return result;
  // }

  // **NEW LOGIC - Use the backdated sales return date for calculations**
  const returnDateMoment = moment.tz(salesReturnDate, "Asia/Kolkata");

  const returnMonth = returnDateMoment.month() + 1; // month() is 0-based
  const returnYear = returnDateMoment.year();

  const currentMonth = moment().month() + 1;
  const currentYear = moment().year();

  // If return is from current month, no deduction
  if (returnMonth === currentMonth && returnYear === currentYear) {
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
