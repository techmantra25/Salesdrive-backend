const asyncHandler = require("express-async-handler");
const LedgerCollection = require("../../models/ledgerCollection.model");
const {
  generateCode,
  ledgerTransactionCode,
} = require("../../utils/codeGenerator");
const CreditNoteModel = require("../../models/creditNote.model");
const Ledger = require("../../models/ledger.model");
const Bill = require("../../models/bill.model");

const createLedgerCollection = asyncHandler(async (req, res) => {
  try {
    const {
      collectionType,
      retailerId,
      totalCollectionAmount,
      totalDiscountAmount,
      totalCreditNoteAmount,
      totalAmountByCollection,
      lineItems,
      remarks,
    } = req.body;

    let collectionNo;
    if (collectionType == "bill_wise") {
      collectionNo = await generateCode("BCOL");
    } else {
      collectionNo = await generateCode("RCOL");
    }

    // Create the ledger collection
    const newLedgerCollection = await LedgerCollection.create({
      distributorId: req.user._id,
      collectionType,
      collectionNo: collectionNo,
      retailerId,
      totalCollectionAmount,
      totalDiscountAmount,
      totalCreditNoteAmount,
      totalAmountByCollection,
      lineItems,
      remarks,
    });

    for (const item of lineItems) {
      const { creditNoteAdjusted = [] } = item;

      if (creditNoteAdjusted.length) {
        const creditNoteIds = creditNoteAdjusted.map(
          (entry) => entry.creditNoteId
        );

        const creditNotes = await CreditNoteModel.find({
          _id: { $in: creditNoteIds },
        });

        for (const creditNote of creditNotes) {
          const adjustedEntry = creditNoteAdjusted.find(
            (entry) =>
              entry.creditNoteId.toString() === creditNote._id.toString()
          );
          if (!adjustedEntry) continue;

          const adjustedAmount = adjustedEntry.amount || 0;

          // Update the adjustedBillIds (here using collectionId instead of billId)
          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            {
              $push: {
                adjustedBillIds: {
                  billId: item.billId,
                  collectionId: newLedgerCollection._id,
                  adjustedAmount,
                  type: "Collection",
                },
              },
            },
            { new: true }
          );

          // Check if the credit note is fully adjusted
          const updatedCreditNote = await CreditNoteModel.findById(
            creditNote._id
          );
          const totalAdjusted = updatedCreditNote.adjustedBillIds.reduce(
            (sum, entry) => sum + entry.adjustedAmount,
            0
          );

          if (totalAdjusted >= updatedCreditNote.amount) {
            await CreditNoteModel.findByIdAndUpdate(
              creditNote._id,
              { creditNoteStatus: "Completely Adjusted" },
              { new: true }
            );
          }
        }
      }

      // fetching billIds from lineItems
      const billIds = lineItems.map((item) => item.billId);

      // update CollectionId in that bills in filed ledgerCollectionId
      const updatedBills = await Bill.updateMany(
        { _id: { $in: billIds } },
        { $addToSet: { ledgerCollectionId: newLedgerCollection._id } }
      );
    }

    if (collectionType == "bill_wise") {
      for (const item of lineItems) {
        const billId = item?.billId;
        const billData = await Bill.findById(billId);
        const retailerId = billData?.retailerId;

        const discountAmount = Number(item?.discountAmount);
        const creditNoteAdjusted = item?.creditNoteAdjusted || [];
        let totalCreditNoteAmount = 0;
        for (const entry of creditNoteAdjusted) {
          totalCreditNoteAmount += Number(entry.amount) || 0;
        }
        const collectionAmount =
          Number(item?.collectionAmount) + Number(totalCreditNoteAmount);

        // Add 200ms delay
        await new Promise((resolve) => setTimeout(resolve, 100));

        const latestLedger = await Ledger.findOne({
          dbId: req.user._id,
          retailerId: retailerId,
        }).sort({ createdAt: -1 });

        let latestLedgerBalance = 0;
        if (latestLedger) {
          latestLedgerBalance = latestLedger?.balance;
        }

        const transactionId = await ledgerTransactionCode("LEDG", req.user._id);

        await Ledger.create({
          dbId: req.user._id,
          retailerId: retailerId,
          transactionId,
          transactionType: "credit",
          transactionFor: "Collection",
          collectionId: newLedgerCollection._id,
          billId: billId,
          transactionAmount: Number(collectionAmount),
          balance: (
            Number(latestLedgerBalance) + Number(collectionAmount)
          ).toFixed(2),
        });

        // give a 200ms delay before processing the next item
        await new Promise((resolve) => setTimeout(resolve, 100));
        // if discount amount is greater than 0, add a debit transaction for the ledger
        if (discountAmount > 0) {
          const latestLedger = await Ledger.findOne({
            dbId: req.user._id,
            retailerId: retailerId,
          }).sort({ createdAt: -1 });

          let latestLedgerBalance = 0;
          if (latestLedger) {
            latestLedgerBalance = latestLedger?.balance;
          }

          const discountTransactionId = await ledgerTransactionCode(
            "LEDG",
            req.user._id
          );

          await Ledger.create({
            dbId: req.user._id,
            retailerId: retailerId,
            transactionId: discountTransactionId,
            transactionType: "credit",
            transactionFor: "Collection-Discount",
            collectionId: newLedgerCollection._id,
            billId: billId,
            transactionAmount: Number(discountAmount),
            balance: (
              Number(latestLedgerBalance) + Number(discountAmount)
            ).toFixed(2),
          });
        }

        // give a 200ms delay before processing the next item
        await new Promise((resolve) => setTimeout(resolve, 100));
        // if credit note amount is greater than 0, add a credit transaction for the ledger
        if (totalCreditNoteAmount > 0) {
          const latestLedger = await Ledger.findOne({
            dbId: req.user._id,
            retailerId: retailerId,
          }).sort({ createdAt: -1 });

          let latestLedgerBalance = 0;
          if (latestLedger) {
            latestLedgerBalance = latestLedger?.balance;
          }

          const creditNoteTransactionId = await ledgerTransactionCode(
            "LEDG",
            req.user._id
          );

          await Ledger.create({
            dbId: req.user._id,
            retailerId: retailerId,
            transactionId: creditNoteTransactionId,
            transactionType: "credit",
            transactionFor: "Collection-Credit-Adjustment",
            collectionId: newLedgerCollection._id,
            billId: billId,
            transactionAmount: Number(totalCreditNoteAmount),
            balance: (
              Number(latestLedgerBalance) + Number(totalCreditNoteAmount)
            ).toFixed(2),
          });
        }
      }
    } else {
      const discountAmount = Number(totalDiscountAmount);
      const creditNoteAmount = Number(totalCreditNoteAmount);
      const collectionAmount = Number(totalCollectionAmount) + creditNoteAmount;

      const latestLedger = await Ledger.findOne({
        dbId: req.user._id,
        retailerId: retailerId,
      }).sort({ createdAt: -1 });

      let latestLedgerBalance = 0;
      if (latestLedger) {
        latestLedgerBalance = latestLedger?.balance;
      }

      const transactionId = await ledgerTransactionCode("LEDG", req.user._id);

      await Ledger.create({
        dbId: req.user._id,
        retailerId: retailerId,
        transactionId,
        transactionType: "credit",
        transactionFor: "Collection",
        collectionId: newLedgerCollection._id,
        transactionAmount: collectionAmount,
        balance: (Number(latestLedgerBalance) + collectionAmount).toFixed(2),
      });

      // give a 200ms delay before processing the next item
      await new Promise((resolve) => setTimeout(resolve, 100));

      // if discount amount is greater than 0, add a credit transaction for the ledger
      if (discountAmount > 0) {
        const latestLedger = await Ledger.findOne({
          dbId: req.user._id,
          retailerId: retailerId,
        }).sort({ createdAt: -1 });

        let latestLedgerBalance = 0;
        if (latestLedger) {
          latestLedgerBalance = latestLedger?.balance;
        }

        const discountTransactionId = await ledgerTransactionCode(
          "LEDG",
          req.user._id
        );

        await Ledger.create({
          dbId: req.user._id,
          retailerId: retailerId,
          transactionId: discountTransactionId,
          transactionType: "credit",
          transactionFor: "Collection-Discount",
          collectionId: newLedgerCollection._id,
          transactionAmount: discountAmount,
          balance: (
            Number(latestLedgerBalance) + Number(discountAmount)
          ).toFixed(2),
        });
      }

      // give a 200ms delay before processing the next item
      await new Promise((resolve) => setTimeout(resolve, 100));
      // if credit note amount is greater than 0, add a credit transaction for the ledger
      if (creditNoteAmount > 0) {
        const latestLedger = await Ledger.findOne({
          dbId: req.user._id,
          retailerId: retailerId,
        }).sort({ createdAt: -1 });

        let latestLedgerBalance = 0;
        if (latestLedger) {
          latestLedgerBalance = latestLedger?.balance;
        }

        const creditNoteTransactionId = await ledgerTransactionCode(
          "LEDG",
          req.user._id
        );

        await Ledger.create({
          dbId: req.user._id,
          retailerId: retailerId,
          transactionId: creditNoteTransactionId,
          transactionType: "credit",
          transactionFor: "Collection-Credit-Adjustment",
          collectionId: newLedgerCollection._id,
          transactionAmount: creditNoteAmount,
          balance: (
            Number(latestLedgerBalance) + Number(creditNoteAmount)
          ).toFixed(2),
        });
      }
    }

    const createdCollection = await LedgerCollection.findById(
      newLedgerCollection._id
    );

    if (createdCollection) {
      const billIds = createdCollection.lineItems.map((item) => item.billId);
      const bills = await Bill.find({ _id: { $in: billIds } }).populate({
        path: "ledgerCollectionId",
        select: "",
      });

      for (const bill of bills) {
        const billId = bill?._id;
        const ledgerCollections = bill?.ledgerCollectionId || [];
        const billNetAmount = bill?.netAmount;
        let totalCollectionAmount = 0;

        for (const collection of ledgerCollections) {
          const lineItems = collection?.lineItems || [];
          let collectionAmount = 0;
          for (const item of lineItems) {
            if (item.billId.toString() === billId.toString()) {
              let thisCreditNoteAmount =
                item?.creditNoteAdjusted.reduce(
                  (sum, entry) => sum + (Number(entry.amount) || 0),
                  0
                ) || 0;
              const thisCollectionAmount = Number(item?.collectionAmount) || 0;
              const thisDiscountAmount = Number(item?.discountAmount) || 0;

              let amount =
                thisCollectionAmount +
                thisDiscountAmount +
                thisCreditNoteAmount;

              // console.log({
              //   billId,
              //   collectionAmount: item?.collectionAmount,
              //   discountAmount: item?.discountAmount,
              //   thisCreditNoteAmount,
              //   total:
              //     item?.collectionAmount +
              //     item?.discountAmount +
              //     thisCreditNoteAmount,
              //   amount,
              // });

              collectionAmount += amount;
            }
          }

          totalCollectionAmount += collectionAmount;
        }

        // console.log({
        //   billId,
        //   totalCollectionAmount,
        //   billNetAmount,
        // });

        if (totalCollectionAmount >= billNetAmount) {
          // update the bill with ledgerCollectionStatus Completely Paid
          await Bill.findByIdAndUpdate(
            billId,
            { ledgerCollectionStatus: "Completely Paid" },
            { new: true }
          );
        } else if (
          totalCollectionAmount > 0 &&
          totalCollectionAmount < billNetAmount
        ) {
          // update the bill with ledgerCollectionStatus Partially Paid
          await Bill.findByIdAndUpdate(
            billId,
            { ledgerCollectionStatus: "Partially Paid" },
            { new: true }
          );
        } else {
          // update the bill with ledgerCollectionStatus Pending Payment
          await Bill.findByIdAndUpdate(
            billId,
            { ledgerCollectionStatus: "Pending Payment" },
            { new: true }
          );
        }
      }
    }

    res.status(201).json({
      success: true,
      message: "Ledger collection created successfully",
      data: newLedgerCollection,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createLedgerCollection };
