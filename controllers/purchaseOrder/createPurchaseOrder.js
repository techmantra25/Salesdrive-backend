const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Supplier = require("../../models/supplier.model"); // adjust path/name to your actual Supplier model
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { purchaseOrderNumberGenerator } = require("../../utils/codeGenerator");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");

const createPurchaseOrder = asyncHandler(async (req, res) => {
  try {
    const {
      distributorId,
      selectedBrand,
      selectedPlant,
      supplierId,
      expectedDeliveryDate,
      lineItems,
      totalLines,
      grossAmount,
      taxableAmount,
      netAmount,
      totalGSTAmount,
      remarks,
      rejectedReason,
      orderRemark,
      status,
      totalBasePoints,
    } = req.body;

    console.log("Received data for creating purchase order:", req.body);

    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }

    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    // ✅ AUTHORITATIVE STATE COMPARISON — backend decides IGST vs CGST/SGST,
    // never trusts frontend and never infers it from a product's static igst field.
    const distributorStateId = distributor.stateId
      ? distributor.stateId.toString()
      : null;
    const supplierStateId = supplier.stateId
      ? supplier.stateId.toString()
      : null;

    if (!distributorStateId || !supplierStateId) {
      return res.status(400).json({
        message:
          "Cannot determine GST type: distributor or supplier is missing a stateId",
      });
    }

    const isInterState = distributorStateId !== supplierStateId;

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
      approved_by = distributorId;
    }

    if (
      need_employee_approval_for_po === "agent approval" ||
      need_employee_approval_for_po === "admin approval"
    ) {
      approvedStatus = "Not Approved";
      approved_by = null;
    }

    // 🔥 LINE ITEM LOOP
    for (const item of lineItems) {

      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({
          message: `Product not found for ID ${item.product}`
        });
      }

      const price = await Price.findById(item.price);
      if (!price) {
        return res.status(404).json({
          message: `Price not found for ID ${item.price}`
        });
      }

      if (item.inventoryId) {
        const inventory = await Inventory.findById(item.inventoryId);
        if (!inventory) {
          return res.status(404).json({
            message: `Inventory not found for ID ${item.inventoryId}`,
          });
        }
      }

      if (!item.plant || item.plant === "") {
        item.plant = null;
      }

      // ✅ GST RATES come from the product's stored slabs,
      // but WHICH slab applies (IGST vs CGST+SGST) is decided by state comparison, not by
      // whether product.igst happens to be non-zero.
      let productCgst = Number(product.cgst || 0);
      let productSgst = Number(product.sgst || 0);
      let productIgst = Number(product.igst || 0);

      // Fallback default slab if the product has no GST configured at all
      if (productCgst === 0 && productSgst === 0 && productIgst === 0) {
        productCgst = 9;
        productSgst = 9;
        productIgst = 18;
      }

      item.l1Basic = Number(item.l1Basic || 0);
      item.orderQty = Number(item.orderQty || 0);

      const basicAmt = Number(item.basicAmt || 0);
      const soValue = item.orderQty * basicAmt;

      item.taxableAmt = soValue;

      if (isInterState) {
        item.cgst = 0;
        item.sgst = 0;
        item.igst = productIgst;

        item.totalCGST = 0;
        item.totalSGST = 0;
        item.totalIGST = (soValue * productIgst) / 100;
      } else {
        item.cgst = productCgst;
        item.sgst = productSgst;
        item.igst = 0;

        item.totalCGST = (soValue * productCgst) / 100;
        item.totalSGST = (soValue * productSgst) / 100;
        item.totalIGST = 0;
      }

      item.totalGST =
        (item.totalCGST || 0) +
        (item.totalSGST || 0) +
        (item.totalIGST || 0);

      item.lineTotal = soValue + item.totalGST;

      item.grossAmt = soValue;
      item.netAmt = item.lineTotal;
    }

    // 🔥 TOTAL CALCULATION
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    let totalGSTAmountCalc = 0;
    let grossAmountCalc = 0;
    let netAmountCalc = 0;

    for (const item of lineItems) {
      totalCGST += item.totalCGST || 0;
      totalSGST += item.totalSGST || 0;
      totalIGST += item.totalIGST || 0;
      totalGSTAmountCalc += item.totalGST || 0;
      grossAmountCalc += item.taxableAmt || 0;
      netAmountCalc += item.lineTotal || 0;
    }

    // Generate order number
    const orderNumber = await purchaseOrderNumberGenerator("PO");

    // 🔥 SAVE
    const newPurchaseOrder = new PurchaseOrder({
      distributorId,
      selectedBrand,
      selectedPlant,
      purchaseOrderNo: orderNumber,
      supplierId,
      expectedDeliveryDate,
      lineItems,
      totalLines,

      grossAmount: grossAmountCalc,
      taxableAmount: grossAmountCalc,

      cgst: totalCGST,
      sgst: totalSGST,
      igst: totalIGST,

      netAmount: netAmountCalc,
      totalGSTAmount: totalGSTAmountCalc,

      remarks,
      approvedStatus,
      rejectedReason,
      approved_by,
      status,
      invoicestatus: "Pending",
      orderRemark,
      totalBasePoints,
    });

    const savedPurchaseOrder = await newPurchaseOrder.save();
    const purchaseOrderId = savedPurchaseOrder._id;

    // Update Inventory In-Transit Qty
    for (const item of lineItems) {
      await Inventory.findOneAndUpdate(
        {
          distributorId,
          productId: item.product,
        },
        {
          $inc: {
            intransitQty: Number(item.orderQty || 0),
          },
        },
        {
          new: true,
        }
      );
    }

    res.status(200).json({
      status: 200,
      message: "Purchase Order created successfully",
      data: savedPurchaseOrder,
    });

  } catch (error) {
    res.status(400).json({ message: error.message || "Something went wrong" });
  }
});

module.exports = { createPurchaseOrder };