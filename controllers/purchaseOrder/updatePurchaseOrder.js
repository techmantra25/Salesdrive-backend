const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Supplier = require("../../models/supplier.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const { SERVER_URL } = require("../../config/server.config");
const axios = require("axios");

// FIX: "plant" is no longer required/used for Purchase Order line items.
// Previously, if a line item had no plant assigned, the frontend sent
// plant: "" (empty string), and Mongoose threw:
//   "Cast to embedded failed for value ... plant: '' ... CastError"
// because it tried (and failed) to cast "" to an ObjectId.
// This helper strips out any plant value that isn't a valid ObjectId
// (including "", null, undefined) so Mongoose never attempts that cast,
// regardless of what the schema says.
const sanitizeLineItems = (lineItems) => {
  if (!Array.isArray(lineItems)) return lineItems;

  return lineItems.map((item) => {
    const cleaned = { ...item };

    if (
      !cleaned.plant ||
      !mongoose.Types.ObjectId.isValid(cleaned.plant)
    ) {
      // Remove the key entirely instead of setting null, so it doesn't
      // even get sent to Mongoose for casting.
      delete cleaned.plant;
    }

    return cleaned;
  });
};

// ---------------------------------------------------------------------
// Draft -> Confirmed repricing
// ---------------------------------------------------------------------


const resolveCurrentPrice = async (
  productId,
  distributor,
  asOfDate = new Date()
) => {
  const dateFilter = {
    effective_date: { $lte: asOfDate },
    $or: [{ expiresAt: null }, { expiresAt: { $gte: asOfDate } }],
  };

  let price = await Price.findOne({
    productId,
    price_type: "distributor",
    distributorId: distributor._id,
    status: true,
    ...dateFilter,
  }).sort({ effective_date: -1 });

  if (!price && distributor.regionId) {
    price = await Price.findOne({
      productId,
      price_type: "regional",
      regionId: distributor.regionId,
      status: true,
      ...dateFilter,
    }).sort({ effective_date: -1 });
  }

  if (!price) {
    price = await Price.findOne({
      productId,
      price_type: "national",
      status: true,
      ...dateFilter,
    }).sort({ effective_date: -1 });
  }

  return price;
};

const resolveIsInterState = async (purchaseOrder) => {
  const distributor = await Distributor.findById(purchaseOrder.distributorId);
  const supplier = await Supplier.findById(purchaseOrder.supplierId);

  const distributorStateId = distributor?.stateId
    ? distributor.stateId.toString()
    : null;
  const supplierStateId = supplier?.stateId
    ? supplier.stateId.toString()
    : null;

  if (!distributorStateId || !supplierStateId) {
    return { distributor, isInterState: null };
  }

  return {
    distributor,
    isInterState: distributorStateId !== supplierStateId,
  };
};

const repriceLineItemsForConfirm = async (purchaseOrder) => {
  const { distributor, isInterState } = await resolveIsInterState(
    purchaseOrder
  );

  // Can't determine distributor OR the interstate/intrastate split —
  // leave every line item exactly as it was rather than guessing.
  if (!distributor || isInterState === null) {
    return purchaseOrder.lineItems;
  }

  const now = new Date();

  return Promise.all(
    purchaseOrder.lineItems.map(async (item) => {
      const plain = item.toObject ? item.toObject() : { ...item };

      try {
        const currentPrice = await resolveCurrentPrice(
          plain.product,
          distributor,
          now
        );

        // No active price found today — keep the originally pinned
        // price/amounts untouched rather than failing the confirm.
        if (!currentPrice) {
          return plain;
        }

        const product = await Product.findById(plain.product);
        if (!product) {
          return plain;
        }

        const mrp = Number(currentPrice.mrp_price || 0);
        const l1 = Number(currentPrice.L1DiscountPercentage || 0);
        const basicAmt = mrp - (mrp * l1) / 100;

        const orderQty = Number(plain.orderQty || 0);
        const soValue = orderQty * basicAmt;

        // GST RATE comes from the product's own slabs, with the same
        // default fallback used at PO creation time; WHICH slab applies
        // (IGST vs CGST+SGST) was already decided above via the
        // authoritative distributor/supplier state comparison.
        let productCgst = Number(product.cgst || 0);
        let productSgst = Number(product.sgst || 0);
        let productIgst = Number(product.igst || 0);

        if (productCgst === 0 && productSgst === 0 && productIgst === 0) {
          productCgst = 9;
          productSgst = 9;
          productIgst = 18;
        }

        let totalCGST = 0;
        let totalSGST = 0;
        let totalIGST = 0;

        if (isInterState) {
          totalIGST = (soValue * productIgst) / 100;
        } else {
          totalCGST = (soValue * productCgst) / 100;
          totalSGST = (soValue * productSgst) / 100;
        }

        const totalGST = totalCGST + totalSGST + totalIGST;

        return {
          ...plain,
          price: currentPrice._id,
          l1Basic: l1,
          grossAmt: soValue,
          taxableAmt: soValue,
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          netAmt: soValue + totalGST,
        };
      } catch (err) {
        // One product's repricing failure must not block confirming the
        // rest of the PO — fall back to its originally pinned price.
        console.error(
          `Repricing failed for product ${plain.product} on PO ${purchaseOrder.purchaseOrderNo}:`,
          err.message
        );
        return plain;
      }
    })
  );
};

// Update Purchase Order
const updatePurchaseOrder = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    // Add updater info to body
    req.body.updatedByType = "Distributor";
    req.body.updatedBy = req.user?._id || null;

    // ✅ Draft -> Confirmed ONLY: reprice every line item off TODAY's
    // active price instead of the price pinned when the draft was
    // created. Skipped if the caller already sent its own lineItems
    // (e.g. an Edit-then-Confirm flow) so we never clobber those edits.
    const isDraftBeingConfirmed =
      purchaseOrder.status === "Draft" && req.body.status === "Confirmed";

    if (isDraftBeingConfirmed && !req.body.lineItems) {
      const repricedLineItems = await repriceLineItemsForConfirm(
        purchaseOrder
      );

      let grossAmountCalc = 0;
      let taxableAmountCalc = 0;
      let totalCGST = 0;
      let totalSGST = 0;
      let totalIGST = 0;
      let totalGSTAmountCalc = 0;
      let netAmountCalc = 0;

      for (const item of repricedLineItems) {
        grossAmountCalc += item.grossAmt || 0;
        taxableAmountCalc += item.taxableAmt || 0;
        totalCGST += item.totalCGST || 0;
        totalSGST += item.totalSGST || 0;
        totalIGST += item.totalIGST || 0;
        totalGSTAmountCalc += item.totalGST || 0;
        netAmountCalc += item.netAmt || 0;
      }

      req.body.lineItems = repricedLineItems;
      req.body.grossAmount = grossAmountCalc;
      req.body.taxableAmount = taxableAmountCalc;
      req.body.cgst = totalCGST;
      req.body.sgst = totalSGST;
      req.body.igst = totalIGST;
      req.body.totalGSTAmount = totalGSTAmountCalc;
      req.body.netAmount = netAmountCalc;
    }

    // FIX: strip out invalid/empty "plant" values from line items so the
    // update never throws a CastError on that field.
    if (req.body.lineItems) {
      req.body.lineItems = sanitizeLineItems(req.body.lineItems);
    }

    let status = req.body.status || purchaseOrder.status;
    let config = {};
    try {
      config = await axios.get(`${SERVER_URL}/api/v1/config/get-config`);
      config = config.data.data;
    } catch (error) {
      res.status(400);
      throw new Error(
        `Error fetching config details: ${
          error?.response?.data?.message || error.message
        }`
      );
    }

    let need_employee_approval_for_po =
      config?.functionalSettings?.need_employee_approval_for_po ||
      "no approval";

    let approvedStatus = "Not Approved";
    let approved_by = null;

    if (
      need_employee_approval_for_po === "no approval" &&
      status === "Confirmed"
    ) {
      approvedStatus = "Approved";
      approved_by = req?.user?._id || null;
    }

    if (
      need_employee_approval_for_po === "agent approval" ||
      need_employee_approval_for_po === "admin approval"
    ) {
      approvedStatus = "Not Approved";
      approved_by = null;
    }

   if (status === "Cancelled") {
  approvedStatus = "Not Approved";
  approved_by = req?.user?._id || null;

  // When PO is cancelled, invoice status should also be cancelled
  req.body.invoicestatus = "Cancelled";
}

    req.body.approvedStatus = approvedStatus;
    req.body.approved_by = approved_by;

    // Update the purchase order
    const updatedPurchaseOrder = await PurchaseOrder.findOneAndUpdate(
      { _id: purchaseOrderId },
      req.body,
      { new: true }
    );

    try {
      // hit the send quotation API
      await axios.get(
        `${SERVER_URL}/api/v1/purchase-order/send-quotation/${purchaseOrderId}`
      );
    } catch (error) {
      // make the approval status as Not Approved
      await PurchaseOrder.findByIdAndUpdate(
        purchaseOrderId,
        {
          $set: {
            approvedStatus: "Not Approved",
            approved_by: null,
            approvedByType: null,
            quotationSuccess: false,
          },
        },
        { new: true }
      );

      res.status(400);
      throw new Error(
        `Error sending quotation: ${
          error?.response?.data?.message || error.message
        }`
      );
    }

    res.status(200).json({
      status: 200,
      message: "Purchase Order updated successfully",
      data: updatedPurchaseOrder,
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Something went wrong" });
  }
});

module.exports = { updatePurchaseOrder };