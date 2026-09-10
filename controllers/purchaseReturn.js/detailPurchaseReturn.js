const asyncHandler = require("express-async-handler");
const PurchaseReturn = require("../../models/PurchasereturnNew.model");

const detailPurchaseReturn = asyncHandler(async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400);
      throw new Error("Purchase return ID is required");
    }

    // Only populate paths that actually exist on the PurchaseReturnNew
    // schema. The old model had invoiceId / lineItems.product /
    // lineItems.plant — none of those exist here anymore, and populating
    // a path that isn't in the schema throws (strictPopulate), which was
    // being swallowed by the catch block below and surfacing as a
    // misleading "not found".
    const purchaseReturn = await PurchaseReturn.findById(id).populate([
      { path: "distributorId", select: "" },
      { path: "godownId", select: "" },
      {
        path: "lineItems.productId",
        model: "Product",
        select: "",
      },
    ]);

    if (!purchaseReturn) {
      res.status(404);
      throw new Error("Purchase return not found");
    }

    res.status(200).json({
      error: false,
      message: "Purchase return details fetched successfully",
      data: purchaseReturn,
    });
  } catch (error) {
    // Preserve whatever status was already set (400/404) instead of
    // always forcing 400, so the frontend gets an accurate status code.
    if (!res.statusCode || res.statusCode === 200) {
      res.status(400);
    }
    throw error;
  }
});

module.exports = { detailPurchaseReturn };