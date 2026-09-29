const asyncHandler = require("express-async-handler");
const axios = require("axios");

const OrderEnquiry = require("../../models/orderEnquiry.model");
const Distributor = require("../../models/distributor.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const OutletApproved = require("../../models/outletApproved.model");
const Godown = require("../../models/godown.model");

const { enquiryNumberGenerator } = require("../../utils/codeGenerator");
const { SERVER_URL } = require("../../config/server.config.js");

const createOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const {
      routeId,
      retailerId,
      godownId,
      orderType,
      orderSource,
      paymentMode,
      manualDate,
      shipToAddress,
      validity,
      deliveryTerms,
      deliverySchedule,
      paymentTerms,
      remarks,

      lineItems = [],
      totalLines,
      totalBasePoints,
      freightCharges,
      handlingCharges,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      adjustedCreditNoteIds,
      creditAmount,
      remark,
    } = req.body;

    const distributorId = req.user.id;

    // --------------------------------------------------
    // Distributor
    // --------------------------------------------------

    const distributor = await Distributor.findById(distributorId);

    if (!distributor) {
      return res.status(404).json({
        message: "Distributor not found",
      });
    }

    // --------------------------------------------------
    // Outlet
    // --------------------------------------------------

    const outlet = await OutletApproved.findById(retailerId);

    if (!outlet) {
      return res.status(404).json({
        message: "Outlet not found",
      });
    }

    // --------------------------------------------------
    // Godown
    // --------------------------------------------------

    if (godownId) {
      const godown = await Godown.findById(godownId);

      if (!godown) {
        return res.status(404).json({
          message: "Godown not found",
        });
      }
    }

    // --------------------------------------------------
    // Validate line items
    // --------------------------------------------------

    for (const item of lineItems) {
      const product = await Product.findById(item.product);

      if (!product) {
        return res.status(404).json({
          message: `Product not found for ID ${item.product}`,
        });
      }

      const price = await Price.findById(item.price);

      if (!price) {
        return res.status(404).json({
          message: `Price not found for ID ${item.price}`,
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

      if (Number(item.oderQty) < 0) {
        return res.status(400).json({
          message: `Negative quantity not allowed for product ${item.product}`,
        });
      }
    }

    // --------------------------------------------------
    // Generate enquiry number
    // --------------------------------------------------

    const enquiryNo = await enquiryNumberGenerator("IPPL");

    // --------------------------------------------------
    // Manual date
    // --------------------------------------------------

    let finalManualDate = new Date();

    if (manualDate) {
      finalManualDate = new Date(manualDate);

      const now = new Date();

      finalManualDate.setHours(
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
      );
    }

    // --------------------------------------------------
    // Create Order Enquiry
    // --------------------------------------------------

    const savedOrderEnquiry = await OrderEnquiry.create({
      distributorId,
      enquiryNo,
      salesmanName: outlet?.employeeId || null,
      routeId,
      retailerId,
      godownId,
      cso: outlet?.cso ?? null,
      orderType,
      orderSource,
      paymentMode,
      manualDate: finalManualDate,
      shipToAddress,
      validity,
      deliveryTerms,
      deliverySchedule,
      paymentTerms,
      remarks,
      lineItems,
      totalLines,
      totalBasePoints,
      grossAmount,
      schemeDiscount,
      distributorDiscount,
      freightCharges,
      handlingCharges,
      taxableAmount,
      cgst,
      sgst,
      igst,
      invoiceAmount,
      roundOffAmount,
      cashDiscount,
      netAmount,
      adjustedCreditNoteIds,
      creditAmount,
      remark,
      cashDiscountApplied: req.body.cashDiscountApplied || false,
      cashDiscountType: req.body.cashDiscountType || "amount",
      cashDiscountValue: req.body.cashDiscountValue || 0,
    });

    // ==================================================
    // RECALCULATE ORDER ENQUIRY
    // ==================================================

    let recalcError = null;

    try {
      const authHeader = req.headers["authorization"];

      const bearerToken =
        authHeader && authHeader.startsWith("Bearer ")
          ? authHeader.split(" ")[1]
          : null;

      const recalcToken = req.cookies?.DBToken || bearerToken;

      if (!recalcToken) {
        recalcError =
          "Authorization token is missing for recalculation";
      } else {
        await axios.post(
          SERVER_URL +
            `/api/v1/order-enquiry/recalculate/${savedOrderEnquiry._id}`,
          {},
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${recalcToken}`,
            },
          }
        );

        // ----------------------------------------------
        // Reload recalculated enquiry
        // ----------------------------------------------

        const freshEnquiry = await OrderEnquiry.findById(
          savedOrderEnquiry._id
        );

        if (freshEnquiry) {
          savedOrderEnquiry.set(freshEnquiry.toObject());
        }
      }
    } catch (e) {
      console.error(
        "RECALCULATE_ERROR createOrderEnquiry:",
        e?.response?.data?.message || e.message
      );

      recalcError =
        "Order Enquiry created, but recalculation failed. " +
        (e?.response?.data?.message || e.message);
    }

    // ==================================================
    // RESPONSE
    // ==================================================

    if (recalcError) {
      return res.status(200).json({
        status: 200,
        message: "Order Enquiry created successfully",
        data: savedOrderEnquiry,
        recalcError,
      });
    }

    res.status(200).json({
      status: 200,
      message: "Order Enquiry created successfully",
      data: savedOrderEnquiry,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = {
  createOrderEnquiry,
};