const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const CreditNoteModel = require("../../models/creditNote.model");
const { orderNumberGenerator } = require("../../utils/codeGenerator");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config.js");
const BillDeliverySetting = require("../../models/billDeliverySetting.model");
const { getOrderBackdate } = require("../../utils/backdateOrderHelper");

// Create Order Entry
const createOrderEntry = asyncHandler(async (req, res) => {
  try {
    const {
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
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
      adjustedCreditNoteIds,
      creditAmount,
      isBillCreate,
    } = req.body;

    const distributorId = req.user.id;

    // Validate distributor
    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }

    // Validate each line item for product, price, and inventory
    for (const item of lineItems) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res
          .status(404)
          .json({ message: `Product not found for ID ${item.product}` });
      }

      const price = await Price.findById(item.price);
      if (!price) {
        return res
          .status(404)
          .json({ message: `Price not found for ID ${item.price}` });
      }

      if (item.inventoryId) {
        const inventory = await Inventory.findById(item.inventoryId);
        if (!inventory) {
          return res.status(404).json({
            message: `Inventory not found for ID ${item.inventoryId}`,
          });
        }
      }
      // making sure that the oder quantity does not goes negative
      if (Number(item.oderQty) < 0) {
        return res.status(400).json({
          message: `Negative quantity not allowed for product ${item.product}`,
        });
      }
    }

    // Generate order number
    const orderNumber = await orderNumberGenerator("DBO");

    // Create the order entry object (not saved yet)
    const newOrderEntry = new OrderEntry({
      distributorId,
      orderNo: orderNumber,
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
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
      adjustedCreditNoteIds,
      creditAmount,
      cashDiscountApplied: req.body.cashDiscountApplied || false,
      cashDiscountType: req.body.cashDiscountType || "amount",
      cashDiscountValue: req.body.cashDiscountValue || 0,
    });

    // Determine if we should backdate the order createdAt (Distributor-only, 1st-2nd)
    // FIX: capture backdateResult outside try block so it is accessible after .save()
    let orderBackdateResult = null;
    try {
      const now = new Date();
      const billDeliverySetting = await BillDeliverySetting.findOne({
        distributorId,
        isActive: true,
      });
      const enableBackdate = billDeliverySetting
        ? billDeliverySetting.enableBackdateBilling
        : false;

      const backdateResult = getOrderBackdate(
        now,
        enableBackdate,
        orderSource,
        now,
      );

      if (backdateResult && backdateResult.isBackdated) {
        // set createdAt/updatedAt to backdate before saving
        newOrderEntry.createdAt = backdateResult.billDate;
        newOrderEntry.updatedAt = backdateResult.billDate;
        // attach metadata fields
        newOrderEntry._isBackdated = true;
        newOrderEntry._createdAtEpoch = backdateResult.billDate.getTime();

        // FIX: store result so we can apply post-save DB update below
        orderBackdateResult = backdateResult;
      }
    } catch (e) {
      // ignore backdate compute errors
      console.warn("BACKDATE_COMPUTE_ERROR on createOrderEntry:", e.message);
    }

    const savedOrderEntry = await newOrderEntry.save();

    // ─── FIX: Force backdated createdAt/updatedAt into DB after save ──────────
    // Mongoose { timestamps: true } silently overwrites createdAt on .save(),
    // so the in-memory assignment above is lost in the DB. This post-save update
    // ensures the correct backdated value is persisted, which is critical for the
    // fallback date path inside multipleBillCreate when _billDateEpoch is absent.
    if (orderBackdateResult && orderBackdateResult.isBackdated) {
      await OrderEntry.findByIdAndUpdate(savedOrderEntry._id, {
        createdAt: orderBackdateResult.billDate,
        updatedAt: orderBackdateResult.billDate,
      });
      // Keep the in-memory copy consistent so the bill creation payload below
      // also reflects the correct backdated timestamp.
      savedOrderEntry.createdAt = orderBackdateResult.billDate;
      savedOrderEntry.updatedAt = orderBackdateResult.billDate;
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (adjustedCreditNoteIds && adjustedCreditNoteIds.length > 0) {
      const creditNoteIds = adjustedCreditNoteIds.map(
        (item) => item.creditNoteId,
      );

      // Fetch all relevant credit notes
      const creditNotes = await CreditNoteModel.find({
        _id: { $in: creditNoteIds },
      });

      for (const creditNote of creditNotes) {
        const orderId = savedOrderEntry._id;

        const adjustedEntry = adjustedCreditNoteIds.find(
          (item) => String(item.creditNoteId) === String(creditNote._id),
        );

        if (!adjustedEntry) continue;

        const adjustedAmount = adjustedEntry.adjustedAmount || 0;

        await CreditNoteModel.findByIdAndUpdate(
          creditNote._id,
          {
            $push: {
              adjustedBillIds: {
                orderId,
                adjustedAmount,
                type: "Order_To_Bill",
                collectionId: null,
              },
            },
          },
          { new: true },
        );

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

    let billData = null;
    let billError = null;

    if (savedOrderEntry && isBillCreate) {
      try {
        // Fetch the order entry details with population
        let orderEntryDetails = await OrderEntry.findById(savedOrderEntry._id)
          .populate([
            { path: "distributorId", select: "" },
            { path: "salesmanName", select: "" },
            { path: "routeId", select: "" },
            {
              path: "retailerId",
              select: "",
              populate: [
                {
                  path: "stateId",
                  select: "",
                  populate: {
                    path: "zoneId",
                    select: "",
                  },
                },
                { path: "regionId", select: "" },
                { path: "beatId", select: "" },
              ],
            },
            { path: "lineItems.product", select: "" },
            { path: "lineItems.price", select: "" },
            { path: "lineItems.inventoryId", select: "" },
            { path: "billIds", select: "" },
          ])
          .lean();

        if (!orderEntryDetails) {
          billError = "Order Entry not found for the created ID";
        } else {
          const authHeader = req.headers["authorization"];
          const bearerToken =
            authHeader && authHeader.startsWith("Bearer ")
              ? authHeader.split(" ")[1]
              : null;
          const token = req.cookies.DBToken || bearerToken;
          if (!token) {
            billError = "Authorization token is missing";
          } else {
            // Prepare data for bill creation
            orderEntryDetails = {
              ...orderEntryDetails,
              orderId: orderEntryDetails._id,
            };

            // Ensure createdAt is explicitly available as epoch to avoid
            // JSON serialization turning Date -> string and losing type info
            try {
              const createdAtDate =
                orderEntryDetails.createdAt instanceof Date
                  ? orderEntryDetails.createdAt
                  : new Date(orderEntryDetails.createdAt);
              orderEntryDetails.createdAt = createdAtDate;
              orderEntryDetails._createdAtEpoch = createdAtDate.getTime();

              // Compute backdate if distributor has backdate enabled
              try {
                const billDeliverySetting = await BillDeliverySetting.findOne({
                  distributorId,
                  isActive: true,
                });

                const backdateResult = getOrderBackdate(
                  createdAtDate,
                  billDeliverySetting
                    ? billDeliverySetting.enableBackdateBilling
                    : false,
                  orderEntryDetails.orderSource,
                  new Date(),
                );

                if (backdateResult && backdateResult.billDate) {
                  orderEntryDetails._billDateEpoch =
                    backdateResult.billDate.getTime();
                  orderEntryDetails._isBackdated = backdateResult.isBackdated;
                }
              } catch (e) {
                // ignore backdate computation errors
                console.warn(
                  "BACKDATE_COMPUTE_ERROR createOrderEntry",
                  e.message,
                );
              }
            } catch (e) {
              // ignore; leave as-is
            }

            const data = { data: [orderEntryDetails] };

            // Debug: show createdAt and epoch sent to bill creation
            console.log("BACKDATE_PAYLOAD createOrderEntry:", {
              orderId: orderEntryDetails._id,
              createdAt: orderEntryDetails.createdAt,
              _createdAtEpoch: orderEntryDetails._createdAtEpoch,
              _billDateEpoch: orderEntryDetails._billDateEpoch,
              _isBackdated: orderEntryDetails._isBackdated,
              orderSource: orderEntryDetails.orderSource,
            });

            // Create bill
            const response = await axios.post(
              SERVER_URL + "/api/v1/bill/create-bulk-bill",
              data,
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
              },
            );

            if (response?.data?.skippedRows?.length > 0) {
              billError = "Bill creation partially failed with skipped rows";
            }

            // Assign billData based on response structure
            billData = response.data;

            // Update credit notes with billId after bill creation
            if (
              billData?.bills?.length > 0 &&
              adjustedCreditNoteIds &&
              adjustedCreditNoteIds.length > 0
            ) {
              const createdBill = billData.bills[0];
              const billId = createdBill._id;

              console.log(
                `✅ Updating credit notes with billId: ${billId} for orderId: ${savedOrderEntry._id}`,
              );

              // Update each credit note's adjustedBillIds entry
              for (const adjustedCN of adjustedCreditNoteIds) {
                const creditNoteId = adjustedCN.creditNoteId;

                // First, find the credit note to get its current state
                const creditNote = await CreditNoteModel.findById(creditNoteId);

                if (creditNote) {
                  // Find the index of the entry that matches orderId and has no billId
                  const entryIndex = creditNote.adjustedBillIds.findIndex(
                    (entry) =>
                      String(entry.orderId) === String(savedOrderEntry._id) &&
                      (!entry.billId || entry.billId === null),
                  );

                  if (entryIndex !== -1) {
                    // Build the update path dynamically
                    const updatePath = `adjustedBillIds.${entryIndex}.billId`;

                    // Update using direct path instead of positional operator
                    const updateResult =
                      await CreditNoteModel.findByIdAndUpdate(
                        creditNoteId,
                        {
                          $set: {
                            [updatePath]: billId,
                          },
                        },
                        { new: true },
                      );

                    if (updateResult) {
                      console.log(
                        `✅ Successfully updated credit note ${creditNoteId} with billId ${billId} at index ${entryIndex}`,
                      );
                    } else {
                      console.warn(
                        `⚠️ Failed to update credit note ${creditNoteId}`,
                      );
                    }
                  } else {
                    console.warn(
                      `⚠️ No matching entry found in credit note ${creditNoteId} for orderId ${savedOrderEntry._id}`,
                    );
                  }
                }

                // Update using array filters (commented out as backup)
                // const updateResult = await CreditNoteModel.updateOne(
                //   {
                //     _id: creditNoteId,
                //     "adjustedBillIds.orderId": savedOrderEntry._id,
                //   },
                //   {
                //     $set: {
                //       "adjustedBillIds.$[elem].billId": billId,
                //     },
                //   },
                //   {
                //     arrayFilters: [
                //       {
                //         "elem.orderId": savedOrderEntry._id,
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
                //     `✅ Successfully updated credit note ${creditNoteId} with billId ${billId}`
                //   );
                // } else {
                //   console.warn(
                //     `⚠️ Failed to update credit note ${creditNoteId} - no matching entry found or already has billId`
                //   );
                // }
              }
            }
          }
        }
      } catch (error) {
        console.error({
          error,
          message: error?.response?.data?.message || error?.message,
        });
        billError =
          "Order Entry created successfully, but Bill creation failed. " +
          (error?.response?.data?.message || error?.message);
      }
    }

    // Return appropriate response based on bill creation status
    if (billError) {
      return res.status(200).json({
        status: 200,
        message: "Order Entry created successfully",
        data: savedOrderEntry,
        billError,
        billData,
      });
    }

    res.status(200).json({
      status: 200,
      message: "Order Entry created successfully",
      data: savedOrderEntry,
      billData,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { createOrderEntry };
