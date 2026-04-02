const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Inventory = require("../../models/inventory.model");
const OrderEntry = require("../../models/orderEntry.model");
const { checkAndUpdatePortalLock } = require("../../utils/checkPortalLock");

const cancelBillUpdate = asyncHandler(async (req, res) => {
  try {
    const { billIds } = req.body; // billIds should be an array of objects [{ bid, remark }]

    if (!Array.isArray(billIds) || billIds.length === 0) {
      return res
        .status(400)
        .json({ message: "Invalid or empty billIds array" });
    }

    // Extract IDs and remarks
    const billIdMap = billIds.map(({ bid, remark }) => ({ bid, remark }));
    const billIdArray = billIdMap.map((item) => item.bid);

    // Fetch all bills that will be canceled
    const bills = await Bill.find({ _id: { $in: billIdArray } });

    if (bills.length === 0) {
      return res.status(404).json({ message: "No bills found to cancel" });
    }

    // Verify bills can be cancelled (not already cancelled/delivered)
    const invalidBills = bills.filter(
      (bill) => bill.status === "Cancelled" || bill.status === "Delivered",
    );

    if (invalidBills.length > 0) {
      return res.status(400).json({
        message:
          "Some bills cannot be cancelled (already cancelled or delivered)",
        invalidBills: invalidBills.map((b) => ({
          billNo: b.billNo,
          status: b.status,
        })),
      });
    }

    const distributorIds = new Set(
      bills.map((bill) => bill.distributorId).filter(Boolean),
    );

    const updatedInventories = [];
    const inventoryUpdateErrors = [];

    // ============================================================
    // STEP 1: UPDATE INVENTORY FIRST (ATOMIC OPERATIONS)
    // ============================================================
    console.log("🔄 Step 1: Releasing reserved quantities...");

    for (const bill of bills) {
      if (!bill.lineItems || bill.lineItems.length === 0) continue;

      for (const item of bill.lineItems) {
        if (!item.inventoryId) continue;

        const billQty = item.billQty ?? 0;

        // Skip if no quantity to release
        if (billQty <= 0) continue;

        try {
          // ATOMIC UPDATE: Release reservedQty back to availableQty
          const updatedInventory = await Inventory.findOneAndUpdate(
            {
              _id: item.inventoryId,
              reservedQty: { $gte: billQty }, // Ensure sufficient reserved qty
            },
            {
              $inc: {
                availableQty: billQty, // Add back to available
                reservedQty: -billQty, // Remove from reserved
              },
            },
            { new: true, runValidators: true },
          );

          if (!updatedInventory) {
            // This happens when reservedQty < billQty (data corruption)
            const currentInventory = await Inventory.findById(item.inventoryId);

            throw new Error(
              `Insufficient reserved quantity. ` +
                `Inventory: ${item.inventoryId}, ` +
                `Current reservedQty: ${currentInventory?.reservedQty || 0}, ` +
                `Bill requires: ${billQty}. ` +
                `This indicates data corruption - please investigate.`,
            );
          }

          updatedInventories.push(updatedInventory._id);

          console.log(
            `✅ Released ${billQty} units from inventory ${item.inventoryId} ` +
              `(Bill: ${bill.billNo})`,
          );
        } catch (error) {
          console.error(
            `❌ Failed to release inventory for bill ${bill.billNo}:`,
            error.message,
          );

          inventoryUpdateErrors.push({
            billNo: bill.billNo,
            inventoryId: item.inventoryId,
            billQty,
            error: error.message,
          });
        }
      }
    }

    // If ANY inventory update failed, abort the entire cancellation
    if (inventoryUpdateErrors.length > 0) {
      console.error("❌ Inventory update failed. Aborting cancellation.");

      return res.status(500).json({
        message: "Failed to release inventory. Cancellation aborted.",
        errors: inventoryUpdateErrors,
        note: "No bills were cancelled. Please fix inventory issues and retry.",
      });
    }

    console.log("✅ All inventory successfully released");

    // ============================================================
    // STEP 2: UPDATE BILL STATUS (Only after inventory is released)
    // ============================================================
    console.log("🔄 Step 2: Updating bill statuses...");

    const updateOperations = billIdMap.map(({ bid, remark }) =>
      Bill.updateOne(
        { _id: bid },
        {
          status: "Cancelled",
          dates: { cancelledDate: new Date() },
          billRemark: remark,
        },
      ),
    );

    const billStatus = await Promise.all(updateOperations);

    if (billStatus.every((update) => update.matchedCount === 0)) {
      return res.status(404).json({
        message: "Failed to update bill statuses",
        warning:
          "Inventory was already released - may need manual reconciliation",
      });
    }

    console.log("✅ Bill statuses updated to Cancelled");

    // ============================================================
    // STEP 3: UPDATE ORDER STATUS
    // ============================================================
    console.log("🔄 Step 3: Updating order statuses...");

    for (const bill of bills) {
      const orderId = bill.orderId;
      if (!orderId) continue;

      try {
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

        if (!order) continue;

        const orderLineItems = order.lineItems;
        const billList = order.billIds;
        const notCanceledBillList = billList.filter(
          (bill) => bill.status !== "Cancelled",
        );

        if (notCanceledBillList.length === 0) {
          // All bills are cancelled - set order to Pending
          await OrderEntry.findByIdAndUpdate(
            orderId,
            { status: "Pending" },
            { new: true },
          );
          console.log(
            `✅ Order ${orderId} set to Pending (all bills cancelled)`,
          );
        } else {
          for (const item of orderLineItems) {
            const orderQty = item.oderQty;
            const productId = item.product._id;
            const billQty = billList
              .filter((bill) => bill.status !== "Cancelled")
              .reduce((acc, bill) => {
                const lineItem = bill.lineItems.find(
                  (lineItem) =>
                    String(lineItem.product._id) === String(productId),
                );
                if (lineItem) {
                  return acc + lineItem.billQty;
                }
                return acc;
              }, 0);

            if (orderQty === billQty) {
              await OrderEntry.findByIdAndUpdate(
                orderId,
                { status: "Completely Billed" },
                { new: true },
              );
              console.log(`✅ Order ${orderId} set to Completely Billed`);
            } else {
              await OrderEntry.findByIdAndUpdate(
                orderId,
                { status: "Partial Billed" },
                { new: true },
              );
              console.log(`✅ Order ${orderId} set to Partial Billed`);
            }
          }
        }
      } catch (error) {
        console.error(`⚠️  Failed to update order ${orderId}:`, error.message);
      }
    }

    // ============================================================
    // STEP 4: UPDATE PORTAL LOCKS
    // ============================================================
    try {
      for (const distributorId of distributorIds) {
        await checkAndUpdatePortalLock(distributorId);
      }
      console.log("✅ Portal locks updated");
    } catch (error) {
      console.error("⚠️  Portal lock update failed:", error.message);
    }

    // ============================================================
    // SUCCESS RESPONSE
    // ============================================================
    return res.status(200).json({
      message: "Bills canceled successfully",
      canceledBills: bills.length,
      updatedInventories: updatedInventories.length,
      details: bills.map((bill) => ({
        billNo: bill.billNo,
        status: "Cancelled",
        inventoryItemsUpdated: bill.lineItems.filter(
          (item) => item.inventoryId && item.billQty > 0,
        ).length,
      })),
    });
  } catch (error) {
    console.error("❌ Bill cancellation error:", error);
    return res.status(500).json({
      message: "Failed to cancel bills",
      error: error.message,
    });
  }
});

module.exports = { cancelBillUpdate };

// Old Code:
// const asyncHandler = require("express-async-handler");
// const Bill = require("../../models/bill.model");
// const Inventory = require("../../models/inventory.model");
// const OrderEntry = require("../../models/orderEntry.model");
// const { checkAndUpdatePortalLock } = require("../../utils/checkPortalLock");

// const cancelBillUpdate = asyncHandler(async (req, res) => {
//   try {
//     const { billIds } = req.body; // billIds should be an array of objects [{ bid, remark }]

//     if (!Array.isArray(billIds) || billIds.length === 0) {
//       return res
//         .status(400)
//         .json({ message: "Invalid or empty billIds array" });
//     }

//     // Extract IDs and remarks
//     const billIdMap = billIds.map(({ bid, remark }) => ({ bid, remark }));
//     const billIdArray = billIdMap.map((item) => item.bid); // Extract only bill IDs

//     // Mark all bills as cancelled and update their remarks
//     const updateOperations = billIdMap.map(({ bid, remark }) =>
//       Bill.updateOne(
//         { _id: bid },
//         {
//           status: "Cancelled",
//           dates: { cancelledDate: new Date() },
//           billRemark: remark,
//         },
//       ),
//     );

//     const billStatus = await Promise.all(updateOperations); // Execute all updates in parallel

//     if (billStatus.every((update) => update.matchedCount === 0)) {
//       return res.status(404).json({ message: "No bills found to cancel" });
//     }

//     // Fetch all bills that were canceled
//     const bills = await Bill.find({ _id: { $in: billIdArray } });
//     const distributorIds = new Set(
//       bills.map((bill) => bill.distributorId).filter(Boolean),
//     );

//     let updatedInventories = [];

//     for (const bill of bills) {
//       if (!bill.lineItems || bill.lineItems.length === 0) continue;

//       for (const item of bill.lineItems) {
//         if (!item.inventoryId) continue; // Ensure inventoryId exists

//         console.log({
//           item,
//         });

//         // Fetch inventory first
//         const inventory = await Inventory.findById(item.inventoryId._id);
//         if (!inventory) continue; // Skip if inventory is not found

//         const billQty = item.billQty ?? 0;

//         // Update inventory
//         inventory.availableQty = inventory.availableQty + billQty;
//         inventory.reservedQty = inventory.reservedQty - billQty;

//         await inventory.save(); // Save changes
//         updatedInventories.push(inventory._id);

//         // check the order and under the order how many bills are there
//         // if all the bills are cancelled then update the order status to pending
//         // if some of the bills are canceled then get the order qty and bill qty for each line items in the  order and check if all the order qty is equal to the sum of all the bill qty if yes then update the order status to completely billed else update the order status to partial billed
//         //:TODO
//         const orderId = bill.orderId;

//         const order = await OrderEntry.findById(orderId).populate([
//           {
//             path: "distributorId",
//             select: "",
//           },
//           {
//             path: "salesmanName",
//             select: "",
//           },
//           {
//             path: "routeId",
//             select: "",
//           },
//           {
//             path: "retailerId",
//             select: "",
//             populate: [
//               {
//                 path: "stateId",
//                 select: "",
//                 populate: {
//                   path: "zoneId",
//                   select: "",
//                 },
//               },
//               {
//                 path: "regionId",
//                 select: "",
//               },
//               {
//                 path: "beatId",
//                 select: "",
//               },
//             ],
//           },
//           {
//             path: "lineItems.product",
//             select: "",
//           },
//           {
//             path: "lineItems.price",
//             select: "",
//           },
//           {
//             path: "lineItems.inventoryId",
//             select: "",
//           },
//           { path: "billIds", select: "" },
//         ]);

//         const orderLineItems = order.lineItems;
//         const billList = order.billIds;
//         const notCanceledBillList = billList.filter(
//           (bill) => bill.status !== "Cancelled",
//         );

//         if (notCanceledBillList.length === 0) {
//           // if all the bills are cancelled then update the order status to pending
//           await OrderEntry.findByIdAndUpdate(
//             orderId,
//             {
//               status: "Pending",
//             },
//             { new: true },
//           );
//         } else {
//           // if some of the bills are canceled then get the order qty and bill qty for each line items in the  order and check if all the order qty is equal to the sum of all the bill qty if yes then update the order status to completely billed else update the order status to partial billed
//           for (const item of orderLineItems) {
//             const orderQty = item.oderQty;
//             const productId = item.product._id;
//             const billQty = billList
//               .filter((bill) => bill.status !== "Cancelled")
//               .reduce((acc, bill) => {
//                 const lineItem = bill.lineItems.find(
//                   (lineItem) =>
//                     lineItem.product._id.toString() === productId.toString(),
//                 );
//                 return acc + lineItem.billQty;
//               }, 0);

//             if (orderQty > billQty) {
//               await OrderEntry.findByIdAndUpdate(
//                 orderId,
//                 {
//                   status: "Partially_Billed",
//                 },
//                 { new: true },
//               );
//             } else if (orderQty < billQty) {
//               await OrderEntry.findByIdAndUpdate(
//                 orderId,
//                 {
//                   status: "Completed_Billed",
//                 },
//                 { new: true },
//               );
//             } else if (orderQty === billQty) {
//               await OrderEntry.findByIdAndUpdate(
//                 orderId,
//                 {
//                   status: "Completed_Billed",
//                 },
//                 { new: true },
//               );
//             }
//           }
//         }
//       }
//     }

//     for (const distributorId of distributorIds) {
//       await checkAndUpdatePortalLock(distributorId);
//     }

//     res.status(200).json({
//       message: "Bills cancelled and inventory updated successfully",
//       updatedInventories,
//     });
//   } catch (error) {
//     res.status(500);
//     throw error;
//   }
// });

// module.exports = { cancelBillUpdate };
