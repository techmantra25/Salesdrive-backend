const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { billPrintUtil } = require("./util/billPrintUtil");
const OrderEntry = require("../../models/orderEntry.model");
const CreditNoteModel = require("../../models/creditNote.model");

// Helper function to extract ID from object or string
function getId(maybeObjOrId) {
  if (!maybeObjOrId) return null;
  if (typeof maybeObjOrId === "string") return maybeObjOrId;
  if (typeof maybeObjOrId === "object") {
    if (maybeObjOrId._id) return String(maybeObjOrId._id);
    if (maybeObjOrId.id) return String(maybeObjOrId.id);
  }
  return null;
}

// Helper function to compare IDs
function sameId(a, b) {
  const ida = getId(a);
  const idb = getId(b);
  if (!ida || !idb) return false;
  return String(ida) === String(idb);
}

const billUpdate = asyncHandler(async (req, res) => {
  try {
    const { previousBillData, newBillData } = req.body;
    const bid = req.params.bid;

    if (!previousBillData || !newBillData) {
      res.status(400);
      throw new Error(
        "Invalid request body: previousBillData and newBillData are required",
      );
    }

    const existingBillData = await Bill.findOne({ _id: bid });
    if (!existingBillData) {
      res.status(404);
      throw new Error("Bill not found");
    }

    // Extract line items
    const oldLineItems = previousBillData?.lineItems || [];
    const newLineItems = newBillData?.lineItems || [];

    // --- VALIDATION PASS: Check inventory, price, and quantity ---
    for (const item of newLineItems) {
      // Normalize IDs
      const inventoryId = getId(item.inventoryId);
      const productId = getId(item.product);
      const priceId = getId(item.price);

      // Fetch product for error messages
      let productDoc = null;
      if (productId) {
        productDoc = await Product.findById(productId);
      }
      const productCodeForMsg =
        productDoc?.product_code || productId || "unknown product";

      // Skip validation for removed items
      if (item?.itemBillType === "Item Removed") {
        continue;
      }

      // Inventory must be present
      if (!inventoryId) {
        return res.status(400).json({
          message: `Inventory not provided for ${productCodeForMsg}.`,
        });
      }

      const inventory = await Inventory.findById(inventoryId);
      if (!inventory) {
        return res.status(400).json({
          message: `Inventory not found for ID ${inventoryId}`,
        });
      }

      // Validate quantity is not negative
      if (typeof item.billQty === "number" && item.billQty < 0) {
        res.status(400);
        throw new Error(`Invalid quantity for ${productCodeForMsg}`);
      }

      // **FIXED STOCK VALIDATION: Account for previously reserved quantity**
      const oldItem = oldLineItems.find((old) =>
        sameId(old.product, productId),
      );
      const oldQty = oldItem ? Number(oldItem.billQty || 0) : 0;
      const newQty = Number(item.billQty || 0);
      const additionalQty = newQty - oldQty;

      // Only validate if we're INCREASING the quantity
      if (additionalQty > 0) {
        const prevAvailableQty = inventory?.availableQty || 0;
        if (additionalQty > prevAvailableQty) {
          res.status(400);
          throw new Error(
            `Insufficient stock for ${productCodeForMsg}. Available: ${prevAvailableQty}, Additional needed: ${additionalQty}`,
          );
        }
      }

      // Price validation for non-replacement items
      if (item?.itemBillType !== "Replacement") {
        if (!priceId) {
          return res.status(404).json({
            message: `Price id missing for product ${productCodeForMsg}`,
          });
        }
        const priceDoc = await Price.findById(priceId);
        if (!priceDoc) {
          return res.status(404).json({
            message: `Price not found for ID ${priceId}`,
          });
        }
      }
    }

    // --- SANITIZE IDs in newBillData ---
    if (Array.isArray(newBillData.lineItems)) {
      newBillData.lineItems = newBillData.lineItems.map((it) => {
        const sanitized = {
          ...it,
          product: getId(it.product) || null,
          price: getId(it.price) || null,
          inventoryId: getId(it.inventoryId) || null,
        };

        // Remove temporary _id for newly added items (starts with "new_")
        if (sanitized._id && String(sanitized._id).startsWith("new_")) {
          delete sanitized._id;
        }

        return sanitized;
      });
    }

    // --- UPDATE BILL IN DATABASE ---
    const updateBillData = await Bill.findOneAndUpdate(
      { _id: bid },
      { $set: newBillData },
      { new: true },
    );

    if (!updateBillData) {
      res.status(400);
      throw new Error("Bill not updated");
    }

    // ✅ HANDLE REMOVED CREDIT NOTES
    const oldAdjustedCreditNotes = previousBillData.adjustedCreditNoteIds || [];
    const newAdjustedCreditNotes = newBillData.adjustedCreditNoteIds || [];

    const removedCreditNotes = oldAdjustedCreditNotes.filter(
      (old) =>
        !newAdjustedCreditNotes.find(
          (newCN) => String(newCN.creditNoteId) === String(old.creditNoteId),
        ),
    );

    // ✅ FIXED: Process removed credit notes first
    if (removedCreditNotes.length > 0) {
      for (const removed of removedCreditNotes) {
        // Remove the bill from the credit note's adjustedBillIds array
        await CreditNoteModel.findByIdAndUpdate(
          removed.creditNoteId,
          {
            $pull: {
              adjustedBillIds: { billId: bid },
            },
          },
          { new: true },
        );

        // ✅ FIXED: Recalculate credit note status after removal
        const updatedCreditNote = await CreditNoteModel.findById(
          removed.creditNoteId,
        );
        if (updatedCreditNote) {
          const totalAdjusted = updatedCreditNote.adjustedBillIds.reduce(
            (sum, entry) => sum + entry.adjustedAmount,
            0,
          );

          // ✅ FIXED: Properly set status based on remaining amount
          const newStatus =
            totalAdjusted >= updatedCreditNote.amount
              ? "Completely Adjusted"
              : "Pending";

          await CreditNoteModel.findByIdAndUpdate(
            removed.creditNoteId,
            { creditNoteStatus: newStatus },
            { new: true },
          );

          console.log(
            `Credit Note ${updatedCreditNote.creditNoteNo}: Status updated to ${newStatus} (adjusted: ${totalAdjusted}/${updatedCreditNote.amount})`,
          );
        }
      }
    }

    // ✅ HANDLE CREDIT NOTE ADJUSTMENTS (new or updated)
    if (
      newBillData.adjustedCreditNoteIds &&
      newBillData.adjustedCreditNoteIds.length > 0
    ) {
      const creditNoteIds = newBillData.adjustedCreditNoteIds.map(
        (item) => item.creditNoteId,
      );

      // Fetch all relevant credit notes
      const creditNotes = await CreditNoteModel.find({
        _id: { $in: creditNoteIds },
      });

      for (const creditNote of creditNotes) {
        const billId = updateBillData._id;

        // Find the corresponding adjusted amount from adjustedCreditNoteIds
        const adjustedEntry = newBillData.adjustedCreditNoteIds.find(
          (item) => String(item.creditNoteId) === String(creditNote._id),
        );

        if (!adjustedEntry) continue;

        const adjustedAmount = adjustedEntry.adjustedAmount || 0;

        // Check if this bill is already in the adjustedBillIds array
        const existingAdjustment = creditNote.adjustedBillIds.find(
          (adj) => String(adj.billId) === String(billId),
        );

        if (existingAdjustment) {
          // Update existing adjustment
          await CreditNoteModel.findOneAndUpdate(
            {
              _id: creditNote._id,
              "adjustedBillIds.billId": billId,
            },
            {
              $set: {
                "adjustedBillIds.$.adjustedAmount": adjustedAmount,
              },
            },
            { new: true },
          );
        } else {
          // Add new adjustment
          await CreditNoteModel.findByIdAndUpdate(
            creditNote._id,
            {
              $push: {
                adjustedBillIds: {
                  billId,
                  adjustedAmount,
                  type: "Order_To_Bill",
                  collectionId: null,
                },
              },
            },
            { new: true },
          );
        }

        // ✅ FIXED: Recalculate and update credit note status
        const updatedCreditNote = await CreditNoteModel.findById(
          creditNote._id,
        );

        const totalAdjusted = updatedCreditNote.adjustedBillIds.reduce(
          (sum, entry) => sum + entry.adjustedAmount,
          0,
        );

        // ✅ FIXED: Set status based on whether fully adjusted
        const newStatus =
          totalAdjusted >= updatedCreditNote.amount
            ? "Completely Adjusted"
            : "Pending";

        await CreditNoteModel.findByIdAndUpdate(
          creditNote._id,
          { creditNoteStatus: newStatus },
          { new: true },
        );

        console.log(
          `Credit Note ${updatedCreditNote.creditNoteNo}: Status updated to ${newStatus} (adjusted: ${totalAdjusted}/${updatedCreditNote.amount})`,
        );
      }
    }

    // --- INVENTORY ADJUSTMENTS ---
    // OLD CODE (commented out - had issues with duplicate products and non-atomic updates)
    // // Helper function to get old line item by product ID
    // function getOldLineItem(productId) {
    //   const pid = getId(productId);
    //   return oldLineItems.find((item) => sameId(item.product, pid));
    // }
    //
    // // Process each new line item
    // for (const item of newLineItems) {
    //   const productId = getId(item.product);
    //   const inventoryId = getId(item.inventoryId);
    //   // Skip if no inventory ID
    //   if (!inventoryId) continue;
    //   const inventory = await Inventory.findById(inventoryId);
    //   if (!inventory) continue;
    //   const oldItem = getOldLineItem(productId);
    //   // If no old item exists (newly added product)
    //   if (!oldItem) {
    //     const newQty = Number(item.billQty || 0);
    //     if (newQty > 0) {
    //       inventory.reservedQty = (inventory.reservedQty || 0) + newQty;
    //       inventory.availableQty = (inventory.availableQty || 0) - newQty;
    //       await inventory.save();
    //     }
    //     continue;
    //   }
    //   // Calculate quantity difference
    //   const oldQty = Number(oldItem.billQty || 0);
    //   const newQty = Number(item.billQty || 0);
    //   const prevReservedQty = inventory?.reservedQty || 0;
    //   const prevAvailableQty = inventory?.availableQty || 0;
    //   if (newQty > oldQty) {
    //     // Quantity increased
    //     const diff = newQty - oldQty;
    //     inventory.reservedQty = prevReservedQty + diff;
    //     inventory.availableQty = prevAvailableQty - diff;
    //     await inventory.save();
    //   } else if (newQty < oldQty) {
    //     // Quantity decreased (including removal when newQty = 0)
    //     const diff = oldQty - newQty;
    //     inventory.reservedQty = Math.max(0, prevReservedQty - diff);
    //     inventory.availableQty = prevAvailableQty + diff;
    //     await inventory.save();
    //   }
    //   // If equal, no changes needed
    // }

    // NEW CODE: Fixed to handle duplicate products correctly and use atomic operations
    // Group quantities by inventoryId to avoid duplicate processing
    const inventoryAdjustments = new Map();

    // Calculate old total quantities per inventory
    for (const oldItem of oldLineItems) {
      const inventoryId = getId(oldItem.inventoryId);
      if (!inventoryId) continue;

      const oldQty = Number(oldItem.billQty || 0);
      const current = inventoryAdjustments.get(inventoryId) || {
        oldTotal: 0,
        newTotal: 0,
      };
      current.oldTotal += oldQty;
      inventoryAdjustments.set(inventoryId, current);
    }

    // Calculate new total quantities per inventory
    for (const newItem of newLineItems) {
      const inventoryId = getId(newItem.inventoryId);
      if (!inventoryId) continue;

      const newQty = Number(newItem.billQty || 0);
      const current = inventoryAdjustments.get(inventoryId) || {
        oldTotal: 0,
        newTotal: 0,
      };
      current.newTotal += newQty;
      inventoryAdjustments.set(inventoryId, current);
    }

    // Process inventory adjustments atomically
    for (const [
      inventoryId,
      { oldTotal, newTotal },
    ] of inventoryAdjustments.entries()) {
      const diff = newTotal - oldTotal;

      // Skip if no change
      if (diff === 0) continue;

      if (diff > 0) {
        // Quantity increased - need to reserve more stock from available
        const updatedInventory = await Inventory.findOneAndUpdate(
          {
            _id: inventoryId,
            availableQty: { $gte: diff }, // Atomic check ensures sufficient stock
          },
          {
            $inc: {
              availableQty: -diff,
              reservedQty: diff,
            },
          },
          { new: true },
        );

        if (!updatedInventory) {
          throw new Error(
            `Insufficient stock to increase bill quantity. Required additional: ${diff} units.`,
          );
        }
      } else {
        // Quantity decreased - return stock from reserved to available
        const returnQty = Math.abs(diff);
        await Inventory.findOneAndUpdate(
          { _id: inventoryId },
          {
            $inc: {
              availableQty: returnQty,
              reservedQty: -returnQty,
            },
          },
          { new: true },
        );
      }
    }

    // --- UPDATE ORDER STATUS ---
    const orderId = existingBillData.orderId;

    if (orderId) {
      const order = await OrderEntry.findById(orderId).populate([
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "salesmanName",
          select: "",
        },
        {
          path: "routeId",
          select: "",
        },
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
            {
              path: "regionId",
              select: "",
            },
            {
              path: "beatId",
              select: "",
            },
          ],
        },
        {
          path: "lineItems.product",
          select: "",
        },
        {
          path: "lineItems.price",
          select: "",
        },
        {
          path: "lineItems.inventoryId",
          select: "",
        },
        { path: "billIds", select: "" },
      ]);

      if (order) {
        const orderLineItems = order.lineItems || [];
        const billList = order.billIds || [];

        const notCanceledBillList = billList.filter(
          (bill) => bill.status !== "Cancelled",
        );

        if (notCanceledBillList.length === 0) {
          // All bills are cancelled -> set order to Pending
          await OrderEntry.findByIdAndUpdate(
            orderId,
            { status: "Pending" },
            { new: true },
          );
        } else {
          // Check each order line item against total billed quantity
          for (const item of orderLineItems) {
            const orderQty = item.oderQty;
            const productId = getId(item.product);

            // Calculate total billed quantity for this product across all non-cancelled bills
            const billQty = billList
              .filter((bill) => bill.status !== "Cancelled")
              .reduce((acc, bill) => {
                if (!Array.isArray(bill.lineItems)) return acc;
                const lineItem = bill.lineItems.find((li) =>
                  sameId(li.product, productId),
                );
                if (!lineItem) return acc;
                return acc + (lineItem.billQty || 0);
              }, 0);

            if (orderQty > billQty) {
              // Order not fully billed
              await OrderEntry.findByIdAndUpdate(
                orderId,
                { status: "Partially_Billed" },
                { new: true },
              );
            } else if (orderQty <= billQty) {
              // Order fully billed (or over-billed)
              await OrderEntry.findByIdAndUpdate(
                orderId,
                { status: "Completed_Billed" },
                { new: true },
              );
            }
          }
        }
      }
    }

    // --- VERIFY INVENTORY CHANGES ---
    console.log("=== INVENTORY VERIFICATION ===");

    const inventoryVerification = [];

    for (const item of newLineItems) {
      const inventoryId = getId(item.inventoryId);
      if (!inventoryId) continue;

      const inventory = await Inventory.findById(inventoryId);
      if (!inventory) continue;

      const productId = getId(item.product);
      const productDoc = await Product.findById(productId);

      const oldItem = oldLineItems.find((old) =>
        sameId(old.product, productId),
      );
      const oldQty = oldItem ? Number(oldItem.billQty || 0) : 0;
      const newQty = Number(item.billQty || 0);

      inventoryVerification.push({
        productCode: productDoc?.product_code || productId,
        productName: productDoc?.name || "Unknown",
        oldBillQty: oldQty,
        newBillQty: newQty,
        qtyChange: newQty - oldQty,
        currentReservedQty: inventory.reservedQty,
        currentAvailableQty: inventory.availableQty,
        totalStock: inventory.reservedQty + inventory.availableQty,
      });
    }

    console.log(
      "Inventory Changes:",
      JSON.stringify(inventoryVerification, null, 2),
    );
    console.log("=== END VERIFICATION ===");

    // --- PRINT BILL ---
    const billId = updateBillData._id;
    billPrintUtil([billId]);

    return res.status(200).json({
      status: 200,
      message: "Bill updated successfully",
      data: updateBillData,
      inventoryChanges: inventoryVerification,
    });
  } catch (error) {
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 400);
    throw error;
  }
});

module.exports = { billUpdate };
