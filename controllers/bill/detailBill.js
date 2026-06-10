const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");

// Delay helper for retrying queries with eventual consistency
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

//detail bill with automatic retry for async writes
const detailBill = asyncHandler(async (req, res) => {
  try {
    const { billId } = req.params;
    const maxRetries = 10; // 10 retries × 1000ms = ~10 seconds max
    let attempt = 0;
    let bill = null;

    console.log(
      `🔍 Searching for billId: ${billId} (will retry up to ${maxRetries} times)`,
    );

    // Retry loop - backend waits internally
    while (attempt <= maxRetries && !bill) {
      attempt++;
      console.log(
        `🔄 Attempt ${attempt}/${maxRetries + 1}: Searching for bill...`,
      );

      // Try to find bill
      bill = await Bill.findById(billId).populate([
        {
          path: "distributorId",
          select: "",
          populate: [
            { path: "stateId", select: "" },
            { path: "brandId", select: "" },
          ],
        },
        { path: "salesmanName", select: "" },
        { path: "routeId", select: "" },
        { path: "orderId", select: "" },
        { path: "retailerId", select: "" },
        { path: "lineItems.product", select: "" },
        { path: "lineItems.price", select: "" },
        { path: "lineItems.inventoryId", select: "" },
        {
          path: "loadSheetId",
          select: "allocationNo createdAt vehicleId",
          populate: { path: "vehicleId", select: "name vehicle_no" },
        },
        {
          path: "salesReturnId",
          select: "",
          populate: { path: "lineItems.product", select: "" },
        },
        { path: "adjustedCreditNoteIds.creditNoteId", select: "" },
        { path: "adjustedReplacementIds.replacementId", select: "" },
        { path: "creditNoteId", select: "" },
        { path: "replacementId", select: "" },
        { path: "ledgerCollectionId", select: "" },
      ]);

      // Bill found
      if (bill) {
        console.log(`✅ Bill found on attempt ${attempt}!`);
        return res.status(200).json({
          status: 200,
          message: "Bill detail",
          data: bill,
        });
      }

      // Not found yet, wait before next attempt
      if (attempt <= maxRetries) {
        console.log(`⏳ Bill not found, waiting 1000ms before retry...`);
        await delay(1000);
      }
    }

    // Max retries exceeded
    console.log("❌ Bill not found after maximum retries");
    return res.status(404).json({
      error: true,
      status: 404,
      message: "Bill not found after maximum wait time",
    });
  } catch (error) {
    console.error("❌ Error in detailBill:", error);
    return res.status(500).json({
      error: true,
      status: 500,
      message: error?.message || "Something went wrong",
    });
  }
});

module.exports = { detailBill };
