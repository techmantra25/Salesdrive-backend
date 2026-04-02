const asyncHandler = require("express-async-handler");
const LoadSheet = require("../../models/loadSheet.model");
const Bill = require("../../models/bill.model");
const { printLoadSheet } = require("./util/printLoadSheet");

const unloadLoadSheet = asyncHandler(async (req, res) => {
  try {
    const { billIds, loadSheetId } = req.body;

    if (!loadSheetId) {
      res.status(400);
      throw new Error("LoadSheet id is required");
    }

    if (!billIds || billIds.length === 0) {
      res.status(400);
      throw new Error("Bill ids are required");
    }

    const loadSheet = await LoadSheet.findById(loadSheetId);
    const previousBillIds = loadSheet.billIds;
    const removedBillIds = billIds;
    const newBillIds = previousBillIds.filter(
      (billId) => !removedBillIds.includes(billId.toString())
    );

    if (newBillIds.length === 0) {
      res.status(400);
      throw new Error("LoadSheet should have at least one bill");
    }

    // Remove the load sheet id from the bills
    for (const bill of removedBillIds) {
      const billData = await Bill.findById(bill);
      if (!billData) {
        res.status(400);
        throw new Error("Bill not found for id: " + bill);
      }

      if (billData.status === "Delivered") {
        res.status(400);
        throw new Error(
          "Bill is already delivered for No: " + billData?.billNo
        );
      }

      if (billData.status === "Cancelled") {
        billData.loadSheetId = null;
        await billData.save();
      }

      if (billData.status === "Vehicle Allocated") {
        billData.status = "Pending";
        billData.loadSheetId = null;
        await billData.save();
      }
    }

    // Remove the bill ids from the load sheet
    loadSheet.billIds = newBillIds;
    await loadSheet.save();

    await printLoadSheet({
      loadSheetIds: [loadSheetId],
      regenerate: true,
    });

    const updatedLoadSheet = await LoadSheet.findById(loadSheetId);

    return res.status(200).json({
      error: false,
      status: 200,
      message: "LoadSheet updated successfully",
      data: updatedLoadSheet,
    });
  } catch (error) {
    res.status(res.statusCode ?? 500);
    throw error;
  }
});

module.exports = { unloadLoadSheet };
