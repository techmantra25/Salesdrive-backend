const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model"); // Assuming Inventory model exists
const { purchaseOrderNumberGenerator } = require("../../utils/codeGenerator");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");

// Create Purchase Order
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
      cgst,
      sgst,
      igst,
      netAmount,
      totalGSTAmount,
      remarks,
      rejectedReason,
      orderRemark,
      status,
      totalBasePoints,
    } = req.body;

    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(404).json({ message: "Distributor not found" });
    }

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
      approved_by = distributorId;
    }

    if (
      need_employee_approval_for_po === "agent approval" ||
      need_employee_approval_for_po === "admin approval"
    ) {
      approvedStatus = "Not Approved";
      approved_by = null;
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
    }

    // Generate order number
    const orderNumber = await purchaseOrderNumberGenerator("PO");

    // Create and save the purchase order
    const newPurchaseOrder = new PurchaseOrder({
      distributorId,
      selectedBrand,
      selectedPlant,
      purchaseOrderNo: orderNumber,
      supplierId,
      expectedDeliveryDate,
      lineItems,
      totalLines,
      grossAmount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      netAmount,
      totalGSTAmount,
      remarks,
      approvedStatus,
      rejectedReason,
      approved_by,
      status,
      orderRemark,
      totalBasePoints,
    });

    const savedPurchaseOrder = await newPurchaseOrder.save();
    const purchaseOrderId = savedPurchaseOrder._id;

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
      message: "Purchase Order created successfully",
      data: savedPurchaseOrder,
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Something went wrong" });
  }
});

module.exports = { createPurchaseOrder };
