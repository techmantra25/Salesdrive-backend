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

  // NOTE: intentionally no `status: true` filter here. `status` only
  // reflects whether a price doc is the *currently* active one — when a
  // new price is created, the previous doc gets flipped to status:false
  // even though its effective_date/expiresAt window genuinely covered
  // earlier dates. For resolving "what price applied on this Order Date"
  // the date window is the source of truth, not the status flag. Same
  // approach already used in bulkCreatePurchaseOrder.js.
  let price = await Price.findOne({
    productId,
    price_type: "distributor",
    distributorId: distributor._id,
    ...dateFilter,
  }).sort({ effective_date: -1 });

  if (!price && distributor.regionId) {
    price = await Price.findOne({
      productId,
      price_type: "regional",
      regionId: distributor.regionId,
      ...dateFilter,
    }).sort({ effective_date: -1 });
  }

  if (!price) {
    price = await Price.findOne({
      productId,
      price_type: "national",
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

const repriceLineItemsForConfirm = async (purchaseOrder, asOfDate) => {
  const { distributor, isInterState } = await resolveIsInterState(
    purchaseOrder
  );

  // Can't determine distributor OR the interstate/intrastate split —
  // leave every line item exactly as it was rather than guessing.
  if (!distributor || isInterState === null) {
    return purchaseOrder.lineItems;
  }

  // Reprice as of the PO's Order Date (manualDate) — NOT the confirm
  // timestamp. A draft created on the 20th and confirmed on the 25th
  // with Order Date left at the 22nd must get the price that was
  // active on the 22nd, not whatever is active today.
  const priceAsOfDate =
    asOfDate || purchaseOrder.manualDate || purchaseOrder.createdAt;

  return Promise.all(
    purchaseOrder.lineItems.map(async (item) => {
      const plain = item.toObject ? item.toObject() : { ...item };

      try {
        const currentPrice = await resolveCurrentPrice(
          plain.product,
          distributor,
          priceAsOfDate
        );

        // No active price found as of the Order Date — keep the
        // originally pinned price/amounts untouched rather than
        // silently falling back to today's price.
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
        console.error(
          `Repricing failed for product ${plain.product} on PO ${purchaseOrder.purchaseOrderNo}:`,
          err.message
        );
        return plain;
      }
    })
  );
};

// ---------------------------------------------------------------------
// Draft edit -> PO Date change repricing
// ---------------------------------------------------------------------
// Same idea as repriceLineItemsForConfirm, but runs off the lineItems the
// client just submitted (with whatever qty/UOM edits were made in the
// Edit page) instead of the previously-pinned purchaseOrder.lineItems.
// Triggered whenever PO Date (manualDate) is edited on a Draft order, so
// moving PO Date to 22 Aug re-resolves each product's price as of 22 Aug,
// and moving it back to today re-resolves today's price.
const repriceLineItemsForDate = async (purchaseOrder, lineItems, asOfDate) => {
  const { distributor, isInterState } = await resolveIsInterState(purchaseOrder);

  // Can't determine distributor OR the interstate/intrastate split —
  // leave every line item exactly as submitted rather than guessing.
  if (!distributor || isInterState === null) {
    return lineItems;
  }

  return Promise.all(
    lineItems.map(async (item) => {
      try {
        const currentPrice = await resolveCurrentPrice(
          item.product,
          distributor,
          asOfDate
        );

        // No active price found as of the new PO Date — keep this line
        // item's price/amounts exactly as submitted rather than silently
        // falling back to today's price.
        if (!currentPrice) {
          return item;
        }

        const product = await Product.findById(item.product);
        if (!product) {
          return item;
        }

        const mrp = Number(currentPrice.mrp_price || 0);
        const l1 = Number(currentPrice.L1DiscountPercentage || 0);
        const basicAmt = mrp - (mrp * l1) / 100;

        const orderQty = Number(item.orderQty || item.oderQty || 0);
        const grossAmt = Number((orderQty * basicAmt).toFixed(2));

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
          totalIGST = (grossAmt * productIgst) / 100;
        } else {
          totalCGST = (grossAmt * productCgst) / 100;
          totalSGST = (grossAmt * productSgst) / 100;
        }

        const totalGST = totalCGST + totalSGST + totalIGST;

        return {
          ...item,
          price: currentPrice._id,
          l1Basic: l1,
          grossAmt,
          taxableAmt: grossAmt,
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          netAmt: Number((grossAmt + totalGST).toFixed(2)),
        };
      } catch (err) {
        console.error(
          `Repricing failed for product ${item.product} on PO ${purchaseOrder.purchaseOrderNo}:`,
          err.message
        );
        return item;
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
      // Prefer the Order Date sent with this Confirm request (the user
      // may have just changed it in the UI before hitting Confirm) over
      // the previously stored manualDate.
      const priceAsOfDate = req.body.manualDate
        ? new Date(req.body.manualDate)
        : purchaseOrder.manualDate || purchaseOrder.createdAt;

      const repricedLineItems = await repriceLineItemsForConfirm(
        purchaseOrder,
        priceAsOfDate
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

     // ✅ Draft edit + PO Date change: whenever the client submits a
    // manualDate (PO Date) along with lineItems while the order is still
    // Draft, re-resolve each line item's price as of that date.
    if (
      purchaseOrder.status === "Draft" &&
      req.body.manualDate &&
      req.body.lineItems
    ) {
      const repricedLineItems = await repriceLineItemsForDate(
        purchaseOrder,
        req.body.lineItems,
        new Date(req.body.manualDate)
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
        `Error fetching config details: ${error?.response?.data?.message || error.message
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
        `Error sending quotation: ${error?.response?.data?.message || error.message
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