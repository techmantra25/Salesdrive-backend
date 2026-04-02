const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const {
  generateBillNo,
  generateNextBillNumber,
} = require("../../utils/codeGenerator");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const {
  getOrderToBillBackdate,
} = require("../../utils/backdateOrdertoBillHelper");
const getOrderStatusToBe = require("./util/getOrderStatusToBe");
const { billPrintUtil } = require("./util/billPrintUtil");
const CreditNoteModel = require("../../models/creditNote.model");
const Replacement = require("../../models/replacement.model");
const Distributor = require("../../models/distributor.model");
const new_billSeries = require("../../models/new_billseries.model");

const createSingleBill = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;

    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      res.status(404);
      throw new Error("Distributor not found");
    }

    const {
      orderId,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      lineItems,
      totalLines,
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
      orderStatusToBe,
      adjustedCreditNoteIds,
      creditAmount,
      adjustedReplacementIds,
    } = req.body;

    const today = new Date();

    const activeBillSeries = await new_billSeries
      .findOne({
        distributorId,
        startDate: { $lte: today },
        $or: [{ endDate: { $gte: today } }, { endDate: null }],
      })
      .sort({ startDate: -1 });

    let newbillNo = null;

    if (activeBillSeries) {
      newbillNo = await generateNextBillNumber(activeBillSeries._id);
      console.log(`generating new billno ${newbillNo}`);
    }
    console.log(`active bill series ${activeBillSeries}`);

    // Validate required fields
    if (lineItems.length === 0) {
      res.status(400);
      throw new Error("At least one line item is required");
    }

    // Check if the order exists
    const order = await OrderEntry.findById(orderId);
    if (!order) {
      res.status(404);
      throw new Error("Order not found");
    }

    // Check if the retailer exists
    const retailer = await OutletApproved.findById(retailerId);
    if (!retailer) {
      res.status(404);
      throw new Error("Retailer not found");
    }

    // validate lineItems
    if (lineItems.length > 0) {
      // Validate each line item for product, price, and inventory
      for (const item of lineItems) {
        console.log({
          item: item,
        });

        const product = await Product.findById(item?.product);

        console.log({
          product: product,
        });

        if (!product) {
          return res.status(404).json({
            message: `Product not found for ID ${item?.product} as provided in line items payload`,
          });
        }

        if (item?.itemBillType !== "Replacement") {
          const price = await Price.findById(item?.price);
          if (!price) {
            return res.status(404).json({
              message: `Price not found for ID ${item?.price} as provided in line items payload`,
            });
          }
        }

        if (item.inventoryId) {
          console.log({
            inventoryId: item.inventoryId,
          });

          const inventory = await Inventory.findById(item?.inventoryId);

          // console.log({
          //   inventory: inventory,
          // });

          if (!inventory) {
            return res.status(400).json({
              message: `Inventory not found for ID ${item?.inventoryId} as provided in line items payload`,
            });
          } else {
            if (item.billQty > 0 && inventory.availableQty < item.billQty) {
              return res.status(400).json({
                message: `Insufficient stock for product ID ${product?.product_code}. Available: ${inventory.availableQty}, Requested: ${item.billQty}`,
              });
            }
          }
        } else {
          return res.status(400).json({
            message: `Inventory not found for product ID ${product?.product_code}. Please ensure inventory is there for the product for distributor with db code ${distributor.dbCode}.`,
          });
        }
      }
    }

    const billNo = await generateBillNo("INV", distributorId);

    // validate Bill no
    if (!billNo) {
      res.status(400);
      throw new Error("Failed to generate bill number");
    }

    //    Previously billDate was set in a separate findByIdAndUpdate AFTER create,
    //    leaving a window where the document had no billDate.
    const billDeliverySetting = await BillDeliverySetting.findOne({
      distributorId,
      isActive: true,
    });

    let billDate = new Date();
    let isBackdated = false;

    if (billDeliverySetting) {
      // Prefer any epoch fields passed in the request body (e.g., from createOrderEntry)
      if (req.body && req.body._billDateEpoch) {
        billDate = new Date(Number(req.body._billDateEpoch));
        isBackdated = true;
      } else if (req.body && req.body._createdAtEpoch) {
        const createdAtDate = new Date(Number(req.body._createdAtEpoch));
        const result = getOrderToBillBackdate(
          createdAtDate,
          billDeliverySetting.enableBackdateBilling,
          new Date(),
        );
        billDate = result.billDate;
        isBackdated = result.isBackdated;
      } else if (req.body && req.body.createdAt) {
        const createdAtDate =
          req.body.createdAt instanceof Date
            ? req.body.createdAt
            : new Date(req.body.createdAt);
        const result = getOrderToBillBackdate(
          createdAtDate,
          billDeliverySetting.enableBackdateBilling,
          new Date(),
        );
        billDate = result.billDate;
        isBackdated = result.isBackdated;
      } else if (order && order._billDateEpoch) {
        billDate = new Date(Number(order._billDateEpoch));
        isBackdated = true;
      } else {
        const orderCreatedAtDate =
          order && order._createdAtEpoch
            ? new Date(Number(order._createdAtEpoch))
            : order && order.createdAt
              ? order.createdAt instanceof Date
                ? order.createdAt
                : new Date(order.createdAt)
              : new Date();

        const result = getOrderToBillBackdate(
          orderCreatedAtDate,
          billDeliverySetting.enableBackdateBilling,
          new Date(),
        );
        billDate = result.billDate;
        isBackdated = result.isBackdated;
      }
    }

    // Create the bill
    const newBill = await Bill.create({
      distributorId,
      new_billseriesid: activeBillSeries ? activeBillSeries._id : null,
      new_billno: newbillNo,
      billNo,
      orderId,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      lineItems,
      totalLines,
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
      billedType: "Single",
      adjustedCreditNoteIds,
      adjustedReplacementIds,
      creditAmount,
      cashDiscountApplied: req.body.cashDiscountApplied || false,
      cashDiscountType: req.body.cashDiscountType || "amount",
      cashDiscountValue: req.body.cashDiscountValue || 0,
      billDate,
      enabledBackDate: isBackdated,
      // Backdate createdAt/updatedAt when applicable
      ...(isBackdated && { createdAt: billDate, updatedAt: billDate }),
    });

    // Ensure createdAt/updatedAt persisted correctly even if mongoose timestamps
    // interfere; use raw collection update for reliability.
    if (isBackdated) {
      await Bill.collection.updateOne(
        { _id: newBill._id },
        { $set: { createdAt: billDate, updatedAt: billDate } },
      );
    }

    // update the order with the new bill
    await OrderEntry.findByIdAndUpdate(
      orderId,
      {
        $push: { billIds: newBill?._id },
      },
      { new: true },
    );

    const orderEntry = await OrderEntry.findById(orderId).populate([
      { path: "billIds", select: "" },
    ]);

    const billList = orderEntry?.billIds;
    const LineItems = orderEntry?.lineItems;

    const billLineItems = newBill?.lineItems;

    const getOrderStatus = getOrderStatusToBe(billList, LineItems);

    // update the Order with the new Order Status
    await OrderEntry.findByIdAndUpdate(
      orderId,
      {
        $set: { status: getOrderStatus },
      },
      { new: true },
    );

    for (const item of billLineItems) {
      if (item.inventoryId && item.billQty > 0) {
        // OLD CODE (commented out - had race condition vulnerability)
        // const inventory = await Inventory.findById(item.inventoryId);
        // if (inventory) {
        //   const updatedAvailableQty =
        //     inventory.availableQty - Number(item.billQty);
        //   const reservedQty = inventory.reservedQty + Number(item.billQty);
        //   // Update the inventory
        //   await Inventory.findOneAndUpdate(
        //     { _id: item.inventoryId },
        //     { availableQty: updatedAvailableQty, reservedQty: reservedQty },
        //     { new: true },
        //   );
        // }

        // NEW CODE: Atomic update with stock validation to prevent negative availableQty
        const updatedInventory = await Inventory.findOneAndUpdate(
          {
            _id: item.inventoryId,
            availableQty: { $gte: Number(item.billQty) }, // Atomic check ensures sufficient stock
          },
          {
            $inc: {
              availableQty: -Number(item.billQty),
              reservedQty: Number(item.billQty),
            },
          },
          { new: true, runValidators: true },
        );

        // If update failed, stock was insufficient (concurrent update or stock exhausted)
        if (!updatedInventory) {
          throw new Error(
            `Insufficient stock for product. Available stock is less than requested quantity (${item.billQty}).`,
          );
        }
      }
    }

    const newBillId = newBill?._id;

    // print the bill
    billPrintUtil([newBillId]);

    if (adjustedCreditNoteIds.length) {
      const creditNoteIds = adjustedCreditNoteIds.map(
        (item) => item.creditNoteId,
      );

      // Fetch all relevant credit notes
      const creditNotes = await CreditNoteModel.find({
        _id: { $in: creditNoteIds },
      });

      for (const creditNote of creditNotes) {
        const billId = newBill._id;

        // Find the corresponding adjusted amount from adjustedCreditNoteIds
        const adjustedEntry = adjustedCreditNoteIds.find(
          (item) => item.creditNoteId == creditNote._id,
        );

        if (!adjustedEntry) continue; // Skip if no matching credit note

        const adjustedAmount = adjustedEntry.adjustedAmount || 0;

        const currentCreditNote = await CreditNoteModel.findById(
          creditNote._id,
        );

        // Find the index of the entry that matches orderId and has no billId
        const entryIndex = currentCreditNote.adjustedBillIds.findIndex(
          (entry) =>
            String(entry.orderId) === String(orderId) &&
            (!entry.billId || entry.billId === null),
        );

        if (entryIndex !== -1) {
          // UPDATE existing entry with billId
          const updatePath = `adjustedBillIds.${entryIndex}.billId`;

          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            {
              $set: {
                [updatePath]: billId,
              },
            },
            { new: true },
          );

          console.log(
            `✅ Updated credit note ${creditNote._id} - added billId ${billId} to existing entry at index ${entryIndex}`,
          );
        } else {
          // This shouldn't happen in normal flow, but handle it
          console.warn(
            `⚠️ No matching orderId entry found in credit note ${creditNote._id} - this may indicate an issue`,
          );
        }

        // // OLD LOGIC: This was adding a NEW entry, causing double-adjustment
        // await CreditNoteModel.findByIdAndUpdate(
        //   creditNote._id,
        //   {
        //     $push: {
        //       adjustedBillIds: {
        //         billId,
        //         adjustedAmount,
        //         type: "Order_To_Bill",
        //         collectionId: null,
        //       },
        //     },
        //   },
        //   { new: true }
        // );

        // Check if credit note is completely adjusted
        const updatedCreditNote = await CreditNoteModel.findById(
          creditNote._id,
        );

        const totalAdjusted = updatedCreditNote.adjustedBillIds.reduce(
          (sum, entry) => sum + entry.adjustedAmount,
          0,
        );

        if (totalAdjusted >= updatedCreditNote.amount) {
          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            { creditNoteStatus: "Completely Adjusted" },
            { new: true },
          );
        }
      }
    }

    if (adjustedReplacementIds.length) {
      const replacementIds = adjustedReplacementIds.map(
        (item) => item.replacementId,
      );

      // Fetch all relevant credit notes
      const replacements = await Replacement.find({
        _id: { $in: replacementIds },
      });

      for (const replacement of replacements) {
        const billId = newBill._id;

        const adjustedEntry = adjustedReplacementIds.find(
          (item) => item.replacementId == replacement._id,
        );

        if (!adjustedEntry) continue;

        const adjustedQty = adjustedEntry.adjustedQty || 0;

        // Update adjustedBillIds array
        await Replacement.findByIdAndUpdate(
          replacement._id, // Replacement ID
          {
            $push: {
              adjustedBillIds: {
                billId,
                adjustedQty,
              },
            },
            $set: {
              status: "Completely Adjusted",
            },
          },
          { new: true },
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Bill created successfully",
      data: newBill,
      billList: billList,
      LineItems: LineItems,
      getOrderStatus: getOrderStatus,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createSingleBill };
