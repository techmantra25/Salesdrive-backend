const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const new_billSeries = require("../../models/new_billseries.model");
const CreditNoteModel = require("../../models/creditNote.model");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const {
  generateBillNo,
  generateNextBillNumber,
} = require("../../utils/codeGenerator");
const { billPrintUtil } = require("./util/billPrintUtil");
const {
  getOrderToBillBackdate,
} = require("../../utils/backdateOrdertoBillHelper");

// Helper function to check for invalid numbers
const isInvalidNumber = (value) =>
  isNaN(Number(value)) || value === null || value === undefined;

const multipleBillCreate = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;
    const { data } = req.body;

    // Check if data exists and is an array
    if (!data || !Array.isArray(data)) {
      return res
        .status(400)
        .json({ message: "Data is required and must be an array" });
    }

    const today = new Date();
    const activeBillSeries = await new_billSeries
      .findOne({
        distributorId,
        startDate: { $lte: today },
        $or: [{ endDate: { $gte: today } }, { endDate: null }],
      })
      .sort({ startDate: -1 });

    // if (!activeBillSeries) {
    //   return res.status(400).json({
    //     message: "No active bill series found for this distributor"
    //   });
    // }

    const bills = [];
    const skippedRows = [];

    //pre allocate bill number to avoid the race condition

    let preallocatedBillNumbers = [];
    if (activeBillSeries) {
      const billCount = data.length;

      //resereveing a rang of bill numbers
      const startSeries = await new_billSeries.findOneAndUpdate(
        { _id: activeBillSeries._id },
        { $inc: { currentNumber: billCount } },
        { new: true },
      );

      if (!startSeries) {
        return res.status(400).json({
          message: "Failed to reserve bill number range",
        });
      }
      //calculating the starting number
      const startNumber = startSeries.currentNumber - billCount + 1;

      for (let i = 0; i < billCount; i++) {
        const number = startNumber + i;
        const paddedNumber = String(number).padStart(
          startSeries.series_number.length,
          "0",
        );
        preallocatedBillNumbers.push(`${startSeries.prefix}${paddedNumber}`);
      }
      console.log(
        `✅ Pre-allocated ${billCount} bill numbers from ${
          preallocatedBillNumbers[0]
        } to ${preallocatedBillNumbers[billCount - 1]}`,
      );
    }
    let successfulBillIndex = 0;

    // ─── Fetch BillDeliverySetting once for the entire batch ─────────────────
    const billDeliverySetting = await BillDeliverySetting.findOne({
      distributorId,
      isActive: true,
    });

    // ─── Process Each Row ─────────────────────────────────────────────────────
    for (let index = 0; index < data?.length; index++) {
      const row = data[index];
      let failedLineItems = []; // Track failed line items for this row
      try {
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
          billedType,
        } = row;

        // Validate that lineItems exist
        if (!lineItems || lineItems?.length === 0) {
          throw new Error("At least one line item is required");
        }

        // Validate number fields to avoid NaN issues
        if (
          isInvalidNumber(totalLines) ||
          isInvalidNumber(totalBasePoints) ||
          isInvalidNumber(grossAmount) ||
          isInvalidNumber(schemeDiscount) ||
          isInvalidNumber(distributorDiscount) ||
          isInvalidNumber(taxableAmount) ||
          isInvalidNumber(cgst) ||
          isInvalidNumber(sgst) ||
          isInvalidNumber(igst) ||
          isInvalidNumber(invoiceAmount) ||
          isInvalidNumber(roundOffAmount) ||
          isInvalidNumber(cashDiscount) ||
          isInvalidNumber(netAmount)
        ) {
          throw new Error(
            "Invalid data in the bill: One or more fields contain invalid numbers.",
          );
        }

        // Check if the order exists
        const order = await OrderEntry.findById(orderId);
        if (!order) {
          throw new Error("Order not found");
        }

        // Check if the order status is Completed_Billed or Cancelled
        if (
          ["Completed_Billed", "Partially_Billed", "Cancelled"].includes(
            order.status,
          )
        ) {
          throw new Error(
            `Order ${orderNo} has already been billed or cancelled or partially billed.`,
          );
        }

        // Check if the retailer exists
        const retailer = await OutletApproved.findById(retailerId);
        if (!retailer) {
          throw new Error("Retailer not found");
        }

        // Validate each line item
        for (const [itemIndex, item] of lineItems.entries()) {
          try {
            const product = await Product.findById(item?.product);
            if (!product) {
              throw new Error(
                `Product not found for ID ${item?.product} in line item #${
                  itemIndex + 1
                }.`,
              );
            }

            const price = await Price.findById(item?.price);
            if (!price) {
              throw new Error(
                `Price not found for ID ${item?.price} in line item #${
                  itemIndex + 1
                }.`,
              );
            }

            if (item?.inventoryId) {
              const inventory = await Inventory.findById(
                item?.inventoryId?._id,
              );
              if (!inventory) {
                throw new Error(
                  `Inventory not found for ID ${
                    item?.inventoryId?._id
                  } in line item #${itemIndex + 1}.`,
                );
              }
              if (Number(item.oderQty) < 0) {
                await createBillLog({
                  billId: null, // bill not saved yet
                  lineItemId: null,
                  event: "NEGATIVE_ORDER_QTY",
                  triggeredBy: "multipleBillCreate",
                  beforeQty: Number(item.oderQty),
                  afterQty: null,
                  userId: distributorId,
                  meta: {
                    productId: item.product,
                    rowIndex: index + 1,
                    itemIndex: i + 1,
                  },
                });
                throw new Error(`Negative oderQty on line item #${i + 1}`);
              }
              if (item.oderQty > 0 && inventory.availableQty < item.oderQty) {
                throw new Error(
                  `Insufficient stock for product ID ${item.product.product_code}. Available: ${inventory.availableQty}, Requested: ${item.oderQty}`,
                );
              }
            }
          } catch (lineItemError) {
            failedLineItems.push({
              lineItemIndex: itemIndex + 1,
              product_code: item?.product
                ? await Product.findById(item?.product).select("product_code")
                : "Unknown",
              error: lineItemError?.message,
            });
          }
        }

        // If any failed line items, skip the current row and don't proceed with the rest
        if (failedLineItems.length > 0) {
          throw new Error("One or more line items failed.");
        }

        // Generate a unique bill number (sequentially)
        const billNo = await generateBillNo("INV", distributorId);
        let newbillNo = null;
        if (activeBillSeries) {
          newbillNo = preallocatedBillNumbers[successfulBillIndex]; // ✅ USE PRE-ALLOCATED
          console.log(
            `Assigning pre-allocated bill #${
              successfulBillIndex + 1
            }: ${newbillNo} for order ${orderNo}`,
          );
        } else {
          console.log(
            `No active bill series for bill ${
              index + 1
            }, using only oldBillNo = ${billNo}`,
          );
        }

        const modifiedLineItems = lineItems.map((item) => ({
          ...item,
          billQty: item.oderQty,
        }));

        // Get adjustedCreditNoteIds and creditAmount from order if they exist
        const adjustedCreditNoteIds = order.adjustedCreditNoteIds || [];
        const creditAmount = order.creditAmount || 0;

        // --- Backdate Bill Logic ---
        let billDate = new Date();
        let isBackdated = false;

        if (billDeliverySetting) {
          // Prefer precomputed epoch fields from incoming payload `row` (sent by createOrderEntry)
          if (row && row._billDateEpoch) {
            billDate = new Date(Number(row._billDateEpoch));
            isBackdated = true;
          } else if (row && row._createdAtEpoch) {
            const createdAtDate = new Date(Number(row._createdAtEpoch));
            const backdateResult = getOrderToBillBackdate(
              createdAtDate,
              billDeliverySetting.enableBackdateBilling,
              new Date(),
            );
            billDate = backdateResult.billDate;
            isBackdated = backdateResult.isBackdated;
          } else if (row && row.createdAt) {
            const createdAtDate =
              row.createdAt instanceof Date
                ? row.createdAt
                : new Date(row.createdAt);
            const backdateResult = getOrderToBillBackdate(
              createdAtDate,
              billDeliverySetting.enableBackdateBilling,
              new Date(),
            );
            billDate = backdateResult.billDate;
            isBackdated = backdateResult.isBackdated;
          } else if (order && order._billDateEpoch) {
            billDate = new Date(Number(order._billDateEpoch));
            isBackdated = true;
          } else {
            // Build a Date from any epoch or createdAt string/object from DB order
            const orderCreatedAtDate =
              order && order._createdAtEpoch
                ? new Date(Number(order._createdAtEpoch))
                : order && order.createdAt
                  ? order.createdAt instanceof Date
                    ? order.createdAt
                    : new Date(order.createdAt)
                  : new Date();

            const backdateResult = getOrderToBillBackdate(
              orderCreatedAtDate,
              billDeliverySetting.enableBackdateBilling,
              new Date(),
            );
            billDate = backdateResult.billDate;
            isBackdated = backdateResult.isBackdated;
          }
        }

        // Create the bill with billDate if needed
        const billData = {
          distributorId,
          new_billseriesid: activeBillSeries ? activeBillSeries._id : null,
          new_billno: newbillNo,
          billNo,
          orderId,
          orderNo,
          salesmanName,
          routeId,
          retailerId,
          lineItems: modifiedLineItems,
          totalLines: totalLines ?? 0,
          totalBasePoints: totalBasePoints ?? 0,
          grossAmount: grossAmount ?? 0,
          schemeDiscount: schemeDiscount ?? 0,
          distributorDiscount: distributorDiscount ?? 0,
          taxableAmount: taxableAmount ?? 0,
          cgst: cgst ?? 0,
          sgst: sgst ?? 0,
          igst: igst ?? 0,
          invoiceAmount: invoiceAmount ?? 0,
          roundOffAmount: roundOffAmount ?? 0,
          cashDiscount: cashDiscount ?? 0,
          netAmount: netAmount ?? 0,
          billedType: billedType ?? "Bulk",
          status: "Pending",
          adjustedCreditNoteIds,
          creditAmount,
          billDate,
          enabledBackDate: isBackdated,
          cashDiscountApplied: order.cashDiscountApplied || false,
          cashDiscountType: order.cashDiscountType || "amount",
          cashDiscountValue: order.cashDiscountValue || 0,
        };
        if (billDate) billData.billDate = billDate;

        const newBill = new Bill(billData);
        const savedBill = await newBill.save();

        if (isBackdated) {
          // Use raw collection update to guarantee the createdAt/updatedAt are set
          await Bill.collection.updateOne(
            { _id: savedBill._id },
            { $set: { createdAt: billDate, updatedAt: billDate } },
          );
        }

        bills.push(savedBill);
        successfulBillIndex++;

        // Update the OrderEntry with the new bill ID
        await OrderEntry.findByIdAndUpdate(
          orderId,
          {
            $push: { billIds: savedBill?._id },
            status: "Completed_Billed",
          },
          { new: true },
        );

        if (
          order.adjustedCreditNoteIds &&
          order.adjustedCreditNoteIds.length > 0
        ) {
          console.log(
            `✅ Updating credit notes for order ${orderNo} with billId: ${savedBill._id}`,
          );

          for (const adjustedCN of order.adjustedCreditNoteIds) {
            const creditNoteId = adjustedCN.creditNoteId;

            try {
              const creditNote = await CreditNoteModel.findById(creditNoteId);

              if (creditNote) {
                const entryIndex = creditNote.adjustedBillIds.findIndex(
                  (entry) =>
                    String(entry.orderId) === String(orderId) &&
                    (!entry.billId || entry.billId === null),
                );

                if (entryIndex !== -1) {
                  const updatePath = `adjustedBillIds.${entryIndex}.billId`;

                  const updateResult = await CreditNoteModel.findByIdAndUpdate(
                    creditNoteId,
                    {
                      $set: {
                        [updatePath]: savedBill._id,
                      },
                    },
                    { new: true },
                  );

                  if (updateResult) {
                    console.log(
                      `✅ Successfully updated credit note ${creditNoteId} with billId ${savedBill._id} at index ${entryIndex}`,
                    );
                  } else {
                    console.warn(
                      `⚠️ Failed to update credit note ${creditNoteId}`,
                    );
                  }
                } else {
                  console.warn(
                    `⚠️ No matching entry found in credit note ${creditNoteId} for orderId ${orderId}`,
                  );
                }
              }

              // // Old Code (commented out as backup)
              // const updateResult = await CreditNoteModel.updateOne(
              //   {
              //     _id: creditNoteId,
              //     "adjustedBillIds.orderId": orderId,
              //   },
              //   {
              //     $set: {
              //       "adjustedBillIds.$[elem].billId": savedBill._id,
              //     },
              //   },
              //   {
              //     arrayFilters: [
              //       {
              //         "elem.orderId": orderId,
              //         $or: [
              //           { "elem.billId": { $exists: false } },
              //           { "elem.billId": null },
              //         ],
              //       },
              //     ],
              //   }
              // );

              // if (updateResult.modifiedCount > 0) {
              //   console.log(
              //     `✅ Successfully updated credit note ${creditNoteId} with billId ${savedBill._id}`
              //   );
              // } else {
              //   console.warn(
              //     `⚠️ Failed to update credit note ${creditNoteId} - no matching entry found or already has billId`
              //   );
              // }
            } catch (cnError) {
              console.error(
                `❌ Error updating credit note ${creditNoteId}:`,
                cnError.message,
              );
            }
          }
        }

        for (const item of billLineItems) {
          if (item.inventoryId && item.billQty > 0) {
            // OLD CODE (commented out - had race condition vulnerability + typo bug using 'oderQty')
            // const inventory = await Inventory.findById(item.inventoryId);
            // if (inventory) {
            //   const updatedAvailableQty =
            //     inventory.availableQty - Number(item.oderQty); // BUG: should be item.billQty
            //   const reservedQty = inventory?.reservedQty + Number(item.oderQty); // BUG: should be item.billQty
            //   // Update the inventory
            //   await Inventory.findOneAndUpdate(
            //     { _id: item.inventoryId },
            //     { availableQty: updatedAvailableQty, reservedQty: reservedQty },
            //     { new: true },
            //   );
            // }

            // NEW CODE: Atomic update with stock validation to prevent negative availableQty
            // Also fixes typo: now using item.billQty instead of item.oderQty
            const updatedInventory = await Inventory.findOneAndUpdate(
              {
                _id: item.inventoryId,
                availableQty: { $gte: Number(item.billQty) }, // Atomic check ensures sufficient stock
              },
              {
                $inc: {
                  availableQty: -Number(item.billQty), // Fixed: was item.oderQty
                  reservedQty: Number(item.billQty), // Fixed: was item.oderQty
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
      } catch (error) {
        skippedRows.push({
          rowIndex: index + 1,
          orderId: row?.orderId,
          orderNo: row?.orderNo,
          error: error?.message,
          failedLineItems:
            failedLineItems.length > 0 ? failedLineItems : undefined,
        });
      }
    }
    if (activeBillSeries && skippedRows.length > 0) {
      const actualHighestUsed = bills.length; // Number of successful bills
      const totalAllocated = data.length;
      const wastedNumbers = totalAllocated - actualHighestUsed;

      if (wastedNumbers > 0) {
        await new_billSeries.findByIdAndUpdate(activeBillSeries._id, {
          $inc: { currentNumber: -wastedNumbers },
        });
        console.log(`⚠️ Rolled back ${wastedNumbers} unused bill numbers`);
      }
    }

    const successBillIds = bills.map((bill) => bill._id);
    // Print the bills
    billPrintUtil(successBillIds);

    // Send a success response with details of processed and skipped rows
    res.status(201).json({
      message: "Bills processed successfully",
      processedCount: bills?.length,
      skippedCount: skippedRows?.length,
      skippedRows,
      bills: bills,
    });
  } catch (error) {
    res.status(500);
    return error;
  }
});

module.exports = { multipleBillCreate };
