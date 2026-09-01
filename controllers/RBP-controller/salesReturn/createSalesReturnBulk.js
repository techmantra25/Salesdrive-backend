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

const createSalesReturnBulk = asyncHandler(async (req, res) => {
  try {
    const {
      salesmanName,
      routeId,
      retailerId,
      godownId, // NEW — the godown selected on the Sales Return Entry screen; stock goes back here
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
      manualDate,
    } = req.body;

    const missingFields = [
      !routeId && "routeId",
      !retailerId && "retailerId",
      !godownId && "godownId", // NEW — required, since inventory is godown-wise now
      !goodsType && "goodsType",
      (!lineItems || !lineItems.length) && "lineItems",
    ].filter(Boolean);

    if (missingFields.length) {
      return res.status(400).json({
        status: 400,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // NEW — resolve the return date+time that will be saved on
    // salesReturnDate / manualDate: the DATE the user picked on the
    // frontend, combined with the CURRENT time-of-day (i.e. the moment
    // this request is being processed) — never midnight, and never the
    // frontend's own clock. Falls back to "right now" entirely if no
    // manualDate was sent.
    const nowInKolkata = moment.tz("Asia/Kolkata");
    let resolvedReturnDate = nowInKolkata.toDate();
    if (manualDate) {
      const parsedManualDate = moment.tz(manualDate, "YYYY-MM-DD", true, "Asia/Kolkata");
      if (!parsedManualDate.isValid()) {
        return res.status(400).json({
          status: 400,
          message: `Invalid manualDate "${manualDate}" — expected format YYYY-MM-DD`,
        });
      }
      parsedManualDate.set({
        hour: nowInKolkata.hour(),
        minute: nowInKolkata.minute(),
        second: nowInKolkata.second(),
        millisecond: nowInKolkata.millisecond(),
      });
      resolvedReturnDate = parsedManualDate.toDate();
    }

    // Bill-wise return: every line item MUST carry its own billId now.
    const missingBillOnItem = lineItems.find((item) => !item.billId);
    if (missingBillOnItem) {
      return res.status(400).json({
        status: 400,
        message: `billId is required on every line item (missing for product ${missingBillOnItem.product})`,
      });
    }

    const [salesMan, beat, retailer] = await Promise.all([
      salesmanName ? Employee.findById(salesmanName) : Promise.resolve(null),
      Beat.findById(routeId),
      OutletApproved.findById(retailerId),
    ]);

    if (salesmanName && !salesMan)
      return res.status(404).json({ status: 404, message: "Salesman not found" });
    if (!beat)
      return res.status(404).json({ status: 404, message: "Beat not found" });
    if (!retailer)
      return res.status(404).json({ status: 404, message: "Retailer not found" });

    const distributor = await Distributor.findById(req.user._id).lean();
    if (!distributor) {
      return res.status(404).json({ status: 404, message: "Distributor not found" });
    }

    // ---- Load every distinct bill referenced by the line items ----
    const uniqueBillIds = [...new Set(lineItems.map((i) => String(i.billId)))];
    const bills = await Bill.find({ _id: { $in: uniqueBillIds } });
    const billMap = new Map(bills.map((b) => [String(b._id), b]));

    const missingBillId = uniqueBillIds.find((id) => !billMap.has(id));
    if (missingBillId) {
      return res.status(404).json({
        status: 404,
        message: `Bill not found: ${missingBillId}`,
      });
    }

    // 90-day check — per bill, since a batch can mix bills from different dates
    for (const bill of bills) {
      const billCreationDate = moment.tz(bill.createdAt, "Asia/Kolkata");
      const currentDate = moment.tz("Asia/Kolkata");
      const daysDiff = currentDate.diff(billCreationDate, "days");
      if (daysDiff > 90) {
        return res.status(400).json({
          status: 400,
          message: `Bill ${bill.billNo} creation date should be within 90 days from today`,
        });
      }
    }

    // ---- Resolve authoritative billQty per line item from the actual Bill doc ----
    for (const item of lineItems) {
      const itemBill = billMap.get(String(item.billId));
      const billLine = itemBill?.lineItems?.find((bl) =>
        item.billLineItemId
          ? String(bl._id) === String(item.billLineItemId)
          : String(bl.product) === String(item.product)
      );

      if (!billLine) {
        return res.status(400).json({
          status: 400,
          message: `Could not find product ${item.product} on bill ${itemBill?.billNo || item.billId}`,
        });
      }

      const authoritativeBillQty = Number(billLine.billQty || 0);
      item.billQty = authoritativeBillQty; // server value always wins

      if (Number(item.returnQty) > authoritativeBillQty) {
        return res.status(400).json({
          status: 400,
          message: `Return qty (${item.returnQty}) exceeds billed qty (${authoritativeBillQty}) for product ${item.product} on bill ${itemBill?.billNo}`,
        });
      }
    }

    // ---- Counters stored on SalesReturnModel only (nothing written to Bill) ----
    // Per-bill: how many Sales Returns already exist against this bill, +1 for this one
    const billReturnCounts = await Promise.all(
      uniqueBillIds.map(async (billId) => {
        const priorCount = await SalesReturnModel.countDocuments({ billId });
        return { billId, returnSequence: priorCount + 1 };
      }),
    );

    // Per-line: how many times THIS product on THIS specific bill has been returned before
    for (const item of lineItems) {
      const priorLineCount = await SalesReturnModel.countDocuments({
        "lineItems.billId": item.billId,
        "lineItems.product": item.product,
      });
      item.returnSequenceForBillLine = priorLineCount + 1;
    }

    const totalReturnQty = lineItems.reduce(
      (sum, item) => sum + Number(item.returnQty || 0),
      0,
    );
    const getNextSalesReturnNo = async () => {
      const lastSalesReturn = await SalesReturnModel.findOne({})
        .sort({ _id: -1 })
        .select("salesReturnNo");

      console.log("salesReturnNo:", JSON.stringify(lastSalesReturn?.salesReturnNo));

      if (!lastSalesReturn) {
        return "SR-001";
      }

      const match = lastSalesReturn.salesReturnNo.match(/\d+$/);

      console.log("match:", match);

      const nextNumber = match ? Number(match[0]) + 1 : 1;

      console.log("nextNumber:", nextNumber);

      return `SR-${String(nextNumber).padStart(3, "0")}`;
    };

    let salesReturnNo = await getNextSalesReturnNo();



    // Use the most recently created bill in this batch to drive the
    // backdate-window calculation (keeps existing backdate behavior sane
    // when a batch spans bills from more than one day).
    const latestBill = bills.reduce((a, b) =>
      new Date(a.createdAt) > new Date(b.createdAt) ? a : b
    );

    const deliverySetting = await BillDeliverySetting.findOne({
      distributorId: distributor._id,
    });
    const enableBackdateBilling = deliverySetting?.enableBackdateBilling === true;

    const actualReturnDate = new Date();
    const backdateFields = calculateBackdateFields(
      latestBill?.createdAt || null,
      actualReturnDate,
      enableBackdateBilling,
    );

    // NOTE — manualDate is intentionally kept separate from backdateFields
    // here. backdateFields still drives createdAt/updatedAt (and every
    // downstream transaction/ledger/credit-note/replacement/RBP date)
    // exactly as before, so those all stay pinned to the real creation
    // time. manualDate only ever ends up on the salesReturnDate field
    // itself, below.

    if (backdateFields.enabledBackDate) {
      console.log(
        `Backdate logic applied for sales return batch (${uniqueBillIds.length} bills): Real return date=${moment(backdateFields.originalDeliveryDate).format("YYYY-MM-DD")}, Backdated to=${moment(backdateFields.deliveryDate).format("YYYY-MM-DD")}`,
      );
    }

    let storePoints = 0;
    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      const lastRetailerTxn = await RetailerOutletTransaction.findOne({
        retailerId: retailerId,
      }).sort({ createdAt: -1 });
      storePoints = lastRetailerTxn
        ? Number(lastRetailerTxn.balance) || 0
        : Number(retailer.currentPointBalance) || 0;
    }

    let totalMultiplierPointsToDeduct = 0;
    let totalMultiplierPointsMetrics = null;

    if (distributor.RBPSchemeMapped === "yes") {
      totalMultiplierPointsMetrics = await getMultiplierPointsToDeduct(
        retailerId,
        totalBasePoints,
        backdateFields.deliveryDate,
        backdateFields.enabledBackDate,
      );

      if (
        totalMultiplierPointsMetrics.pointsToDeduct > 0 &&
        totalMultiplierPointsMetrics.percentage > 0
      ) {
        totalMultiplierPointsToDeduct = totalMultiplierPointsMetrics.pointsToDeduct;
      }
    }

    if (
      distributor.RBPSchemeMapped === "yes" &&
      totalBasePoints > 0 &&
      storePoints < Number(totalBasePoints) + Number(totalMultiplierPointsToDeduct)
    ) {
      return res.status(400).json({
        status: 400,
        message: `Insufficient store points. Available: ${storePoints}, Required: ${Number(totalBasePoints) + Number(totalMultiplierPointsToDeduct)
          }`,
      });
    }

    const salesReturnData = {
      distributorId: req.user._id,
      billId: uniqueBillIds, // NOTE: schema must allow [ObjectId] now, not a single ObjectId — see note below
      salesmanName,
      routeId,
      retailerId,
      godownId, // NEW — which godown this return's stock was credited back to
      goodsType,
      collectionStatus,
      totalReturnQty,
      billReturnCounts,
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
      // NEW — both fields save the frontend-picked date stamped with the
      // current time (see resolvedReturnDate above). createdAt/updatedAt
      // are intentionally left alone below — they always stay as
      // Mongoose's own auto-generated record-creation timestamps.
      salesReturnDate: resolvedReturnDate,
      originalSalesReturnDate: backdateFields.originalDeliveryDate,
      enabledBackDate: backdateFields.enabledBackDate,
    };

    // NEW — salesReturnNo can collide under concurrent requests if
    // generateCodeForSalesReturn isn't perfectly atomic (e.g. two requests
    // both read the same "last number" before either writes). Rather than
    // fail the whole return, catch the duplicate-key error, generate a
    // fresh number, and retry a few times before giving up.
    const MAX_SALES_RETURN_NO_RETRIES = 5;
    let salesReturn;
    for (let attempt = 0; attempt <= MAX_SALES_RETURN_NO_RETRIES; attempt++) {
      try {
        salesReturn = await SalesReturnModel.create({
          ...salesReturnData,
          salesReturnNo,
        });


        await SalesReturnModel.updateOne(
          { _id: salesReturn._id },
          {
            $set: {
              createdAt: resolvedReturnDate,
              updatedAt: resolvedReturnDate,
            },
          },
          {
            timestamps: false,
          }
        );

        salesReturn.createdAt = resolvedReturnDate;
        salesReturn.updatedAt = resolvedReturnDate;
        const last = await SalesReturnModel.findOne({})
          .sort({ _id: -1 })
          .select("salesReturnNo createdAt");


        break;
      } catch (err) {
        const isDuplicateSalesReturnNo =
          err?.code === 11000 &&
          (err?.keyPattern?.salesReturnNo || /salesReturnNo/.test(err?.message || ""));

        if (!isDuplicateSalesReturnNo || attempt === MAX_SALES_RETURN_NO_RETRIES) {
          throw err;
        }

        salesReturnNo = await getNextSalesReturnNo();
      }
    }

    await updateSecondaryTargetOnSalesReturn(salesReturn);

    // Mark every involved bill with this return — not just one
    await Bill.updateMany(
      { _id: { $in: uniqueBillIds } },
      { $push: { salesReturnId: salesReturn._id } },
    );

    let transactions = [];
    let creditNoteItems = [];
    let replacementItems = [];

    for (const item of lineItems) {
      const itemBill = billMap.get(String(item.billId));

      // CHANGED — stock now goes back to whichever godown was selected on
      // the return entry screen (req.body.godownId), NOT necessarily the
      // godown of the original bill's inventory record. Inventory is
      // looked up by product + selected godown instead of by the bill's
      // stored inventoryId.
      const inventory = await Inventory.findOne({
        distributorId: req.user._id,
        productId: item.product,
        godownId: godownId,
      });

      const stockId = await transactionCode("LXSTA");
      if (!inventory) {
        return res.status(404).json({
          status: 404,
          message: `Inventory not found for product ${item.product} in the selected godown`,
        });
      }

      const product = await Product.findById(item.product);
      const priceEntry = await Price.findById(item.price);
      const piecesPerBox = product?.uom === "box" ? product.no_of_pieces_in_a_box || 1 : 1;
      const rlpbyPcs = priceEntry?.rlp_price / piecesPerBox || 0;
      const dlpbyPcs = priceEntry?.dlp_price / piecesPerBox || 0;

      // returnQty and price are both THIS row's own values, so a bill with
      // price 10 / qty 20 always resolves to 200 regardless of other rows.
      if (goodsType === "Salable") {
        inventory.availableQty = (inventory.availableQty || 0) + Number(item.returnQty);
        inventory.totalStockamtDlp += Math.round(dlpbyPcs * Number(item.returnQty));
        inventory.totalStockamtRlp += Math.round(rlpbyPcs * Number(item.returnQty));
      } else {
        inventory.unsalableQty = (inventory.unsalableQty || 0) + Number(item.returnQty);
        inventory.totalUnsalableamtDlp += Math.round(dlpbyPcs * Number(item.returnQty));
        inventory.totalUnsalableStockamtRlp += Math.round(rlpbyPcs * Number(item.returnQty));
      }
      inventory.totalQty = (inventory.availableQty || 0) + (inventory.unsalableQty || 0);
      await inventory.save();

      const transactionData = {
        distributorId: req.user._id,
        transactionId: stockId,
        invItemId: inventory._id, // CHANGED — the godown-resolved inventory doc, not item.inventoryId
        productId: inventory.productId,
        billId: itemBill?._id,
        billLineItemId: item._id,
        qty: item.returnQty,
        date: backdateFields.deliveryDate || new Date(),
        type: "In",
        description: `Sales Return for ${salesReturnNo} (Bill ${itemBill?.billNo || ""})`,
        balanceCount: goodsType === "Salable" ? inventory.availableQty : inventory.unsalableQty,
        transactionType: "salesreturn",
        stockType: goodsType === "Salable" ? "salable" : "unsalable",
        dates: {
          deliveryDate: backdateFields.deliveryDate,
          originalDeliveryDate: backdateFields.originalDeliveryDate,
        },
        enabledBackDate: backdateFields.enabledBackDate,
      };

      if (backdateFields.deliveryDate) {
        transactionData.createdAt = backdateFields.deliveryDate;
        transactionData.updatedAt = backdateFields.deliveryDate;
      }

      const transaction = await Transaction.create(transactionData);

      try {
        await createStockLedgerEntry(transaction._id);
      } catch (error) {
        console.error(
          `Stock ledger creation failed for transaction ${transaction._id}:`,
          error.message,
        );
      }

      transactions.push(transaction);

      if (item.salesReturnType === "Credit Note") {
        creditNoteItems.push({ ...item, adjustmentId: transaction._id, billId: itemBill?._id });
      }
      if (item.salesReturnType === "Replacement") {
        replacementItems.push({ ...item, adjustmentId: transaction._id, billId: itemBill?._id });
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
        billId: creditNoteItems.map((i) => i.billId), // multiple bills possible
        lineItems: creditNoteItems,
        creditNoteNo,
        amount: Math.round(totalAmount),
        creditNoteCreationDate: backdateFields.deliveryDate || new Date(),
        creditNoteStatus: "Pending",
        creditNoteRemark: salesReturn.remarks,
        creditNoteType: "With Reference",
      };

      if (backdateFields.deliveryDate) {
        creditNoteData.createdAt = backdateFields.deliveryDate;
        creditNoteData.updatedAt = backdateFields.deliveryDate;
      }

      const creditNote = await CreditNoteModel.create(creditNoteData);

      // Attach credit note to every bill it references
      const creditNoteBillIds = [...new Set(creditNoteItems.map((i) => String(i.billId)))];
      await Bill.updateMany(
        { _id: { $in: creditNoteBillIds } },
        { $push: { creditNoteId: creditNote._id } },
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      const latestLedger = await Ledger.findOne({
        dbId: req.user._id,
        retailerId: salesReturn.retailerId,
      }).sort({ createdAt: -1 });

      const latestLedgerBalance = latestLedger?.balance || 0;
      const transactionId = await ledgerTransactionCode("LEDG", req.user._id);

      const ledgerCreditNoteData = {
        dbId: req.user._id,
        retailerId: salesReturn.retailerId,
        transactionId,
        transactionType: "debit",
        transactionFor: "Credit Note",
        creditNoteId: creditNote?._id,
        transactionAmount: Math.round(totalAmount),
        balance: (Number(latestLedgerBalance) - Math.round(totalAmount)).toFixed(2),
        date: backdateFields.deliveryDate || new Date(),
      };

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
        billId: replacementItems.map((i) => i.billId),
        lineItems: replacementItems,
        replacementNo,
        replacementDate: backdateFields.deliveryDate || new Date(),
        status: "Pending",
        remark: salesReturn.remarks,
        replacementType: "With Reference",
      };

      if (backdateFields.deliveryDate) {
        replacementData.createdAt = backdateFields.deliveryDate;
        replacementData.updatedAt = backdateFields.deliveryDate;
      }

      const replacement = await Replacement.create(replacementData);

      const replacementBillIds = [...new Set(replacementItems.map((i) => String(i.billId)))];
      await Bill.updateMany(
        { _id: { $in: replacementBillIds } },
        { $push: { replacementId: replacement._id } },
      );
    }

    /*-------- RBP points logic — unchanged except bill.retailerId -> retailerId --------*/

    if (totalBasePoints > 0 && distributor.RBPSchemeMapped === "yes") {
      const lastDistributorTxn = await DistributorTransaction.findOne({
        distributorId: req.user._id,
      }).sort({ createdAt: -1 });

      const distributorPrevBalance = lastDistributorTxn ? Number(lastDistributorTxn.balance) : 0;
      const points = Number(totalBasePoints);

      const distributorTxnData = {
        distributorId: req.user._id,
        transactionType: "credit",
        transactionFor: "Sales Return",
        point: points,
        balance: distributorPrevBalance + points,
        salesReturnId: salesReturn._id,
        retailerId, // was bill?.retailerId — now use the top-level retailerId directly
        status: "Success",
        remark: `Points deducted for Sales Return no ${salesReturnNo} for Retailer UID ${retailer.outletUID} and DB Code ${req.user.dbCode}`,
        dates: {
          deliveryDate: backdateFields.deliveryDate,
          originalDeliveryDate: backdateFields.originalDeliveryDate,
        },
        enabledBackDate: backdateFields.enabledBackDate,
      };

      if (backdateFields.deliveryDate) {
        distributorTxnData.createdAt = backdateFields.deliveryDate;
        distributorTxnData.updatedAt = backdateFields.deliveryDate;
      }

      const distributorTxn = await DistributorTransaction.create(distributorTxnData);

      const lastRetailerTxn2 = await RetailerOutletTransaction.findOne({
        retailerId: salesReturn.retailerId,
      }).sort({ createdAt: -1 });

      const retailerPrevBalance = lastRetailerTxn2
        ? Number(lastRetailerTxn2.balance)
        : Number(retailer.currentPointBalance) || 0;

      const retailerOutletTxnSRData = {
        retailerId: salesReturn.retailerId,
        distributorId: req.user._id,
        salesReturnId: salesReturn._id,
        billId: uniqueBillIds, // spans potentially multiple bills now
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

      if (backdateFields.deliveryDate) {
        retailerOutletTxnSRData.createdAt = backdateFields.deliveryDate;
        retailerOutletTxnSRData.updatedAt = backdateFields.deliveryDate;
      }

      const retailerOutletTxnSR = await RetailerOutletTransaction.create(retailerOutletTxnSRData);

      await DistributorTransaction.updateOne(
        { _id: distributorTxn._id },
        { $set: { retailerOutletTransactionId: retailerOutletTxnSR._id } },
      );

      await OutletApproved.updateOne(
        { _id: salesReturn.retailerId },
        { $inc: { currentPointBalance: -points } },
      );
    }

    if (
      totalMultiplierPointsToDeduct > 0 &&
      totalBasePoints > 0 &&
      distributor.RBPSchemeMapped === "yes"
    ) {
      const salesReturnDateForCalculation = moment.tz(salesReturn.salesReturnDate, "Asia/Kolkata");
      const salesReturnMonthInNumber = salesReturnDateForCalculation.month() + 1;
      const salesReturnYear = salesReturnDateForCalculation.year();

      const lastRetailerTxn3 = await RetailerOutletTransaction.findOne({
        retailerId: salesReturn.retailerId,
      }).sort({ createdAt: -1 });

      const retailerPrevBalance2 = lastRetailerTxn3
        ? Number(lastRetailerTxn3.balance)
        : Number(retailer.currentPointBalance) || 0;

      const retailerOutletTxnSMData = {
        retailerId: salesReturn.retailerId,
        distributorId: req.user._id,
        salesReturnId: salesReturn._id,
        billId: uniqueBillIds,
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

      if (backdateFields.deliveryDate) {
        retailerOutletTxnSMData.createdAt = backdateFields.deliveryDate;
        retailerOutletTxnSMData.updatedAt = backdateFields.deliveryDate;
      }

      const retailerOutletTxnSM = await RetailerOutletTransaction.create(retailerOutletTxnSMData);

      await OutletApproved.updateOne(
        { _id: salesReturn.retailerId },
        { $inc: { currentPointBalance: -totalMultiplierPointsToDeduct } },
      );

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

// Signature changed: now takes retailerId directly instead of a single bill,
// since a batch can span multiple bills.
const getMultiplierPointsToDeduct = async (
  retailerId,
  totalBasePoints,
  salesReturnDate,
  enabledBackDate = false,
) => {
  let result = { pointsToDeduct: 0, percentage: 0 };

  if (enabledBackDate) return result;

  const returnDateMoment = moment.tz(salesReturnDate, "Asia/Kolkata");
  const returnMonth = returnDateMoment.month() + 1;
  const returnYear = returnDateMoment.year();

  const currentMonth = moment().month() + 1;
  const currentYear = moment().year();

  if (returnMonth === currentMonth && returnYear === currentYear) {
    return result;
  }

  const fetchMultiplierPercentage = async (month, year) => {
    const multipliers =
      (await RetailerMultiplierTransaction.find({
        retailerId,
        transactionType: "credit",
        month,
        year,
      }).lean()) || [];

    return multipliers.reduce((sum, item) => sum + (Number(item.slabPercentage) || 0), 0);
  };

  let highestPercentage = 0;
  const now = moment();

  for (let i = 1; i <= 3; i++) {
    const date = moment(now).subtract(i, "month");
    const percentage = await fetchMultiplierPercentage(date.month() + 1, date.year());
    if (percentage > highestPercentage) highestPercentage = percentage;
  }

  if (highestPercentage > 0 && totalBasePoints > 0) {
    result.pointsToDeduct = Math.round((Number(totalBasePoints) * highestPercentage) / 100);
    result.percentage = highestPercentage;
  }

  return result;
};

module.exports = { createSalesReturnBulk };