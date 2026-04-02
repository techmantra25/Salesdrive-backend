const asyncHandler = require("express-async-handler");
const PurchaseReturn = require("../../models/purchaseReturn.model");

const detailPurchaseReturn = asyncHandler(async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400);
      throw new Error("Purchase return ID is required");
    }

    const purchaseReturn = await PurchaseReturn.findById(id).populate([
      { path: "distributorId", select: "" },
      { path: "invoiceId", select: "" },
      {
        path: "lineItems.product",
        model: "Product",
        select: "",
      },
      {
        path: "lineItems.plant",
        model: "Plant",
        select: "",
      },
      {
        path: "invoiceId",
        populate: [
          {
            path: "purchaseReturnIds",
            populate: {
              path: "lineItems.product",
              model: "Product",
              select: "",
            },
          },
          {
            path: "GRNLogId",
          },
        ],
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
    res.status(400);
    throw error;
  }
});

module.exports = { detailPurchaseReturn };
