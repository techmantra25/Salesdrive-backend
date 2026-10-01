const asyncHandler = require("express-async-handler");
const axios = require("axios");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const Product = require("../../models/product.model");
const Price = require("../../models/price.model");
const Inventory = require("../../models/inventory.model");
const { SERVER_URL } = require("../../config/server.config.js");

const getId = (maybeObjOrId) => {
  if (!maybeObjOrId) return null;
  if (typeof maybeObjOrId === "string") return maybeObjOrId;
  if (typeof maybeObjOrId === "object") {
    if (maybeObjOrId._id) return String(maybeObjOrId._id);
    if (maybeObjOrId.id) return String(maybeObjOrId.id);
  }
  return null;
};

const editOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { previousOrderEnquiryData, newOrderEnquiryData } = req.body;

    if (!previousOrderEnquiryData || !newOrderEnquiryData) {
      return res.status(400).json({
        status: 400,
        message:
          "Invalid request body: previousOrderEnquiryData and newOrderEnquiryData are required",
      });
    }

    const existingOrderEnquiry = await OrderEnquiry.findById(id);
    if (!existingOrderEnquiry) {
      return res.status(404).json({
        status: 404,
        message: "Order Enquiry not found",
      });
    }

    if (existingOrderEnquiry.status === "Converted") {
      return res.status(400).json({
        status: 400,
        message: "Converted Order Enquiry cannot be edited",
      });
    }

    const newLineItems = newOrderEnquiryData?.lineItems || [];

    for (const item of newLineItems) {
      const productId = getId(item.product);
      const priceId = getId(item.price);
      const inventoryId = getId(item.inventoryId);

      if (!productId) {
        return res.status(400).json({
          status: 400,
          message: "Product is required for every line item",
        });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({
          status: 404,
          message: `Product not found for ID ${productId}`,
        });
      }

      const productCodeForMsg = product?.product_code || productId;

      if (!priceId) {
        return res.status(400).json({
          status: 400,
          message: `Price is required for product ${productCodeForMsg}`,
        });
      }

      const price = await Price.findById(priceId);
      if (!price) {
        return res.status(404).json({
          status: 404,
          message: `Price not found for ID ${priceId}`,
        });
      }

      if (inventoryId) {
        const inventory = await Inventory.findById(inventoryId);
        if (!inventory) {
          return res.status(404).json({
            status: 404,
            message: `Inventory not found for ID ${inventoryId}`,
          });
        }
      }

      if (Number(item.oderQty || 0) < 0) {
        return res.status(400).json({
          status: 400,
          message: `Negative quantity not allowed for product ${productCodeForMsg}`,
        });
      }

      if (Number(item.boxOrderQty || 0) < 0) {
        return res.status(400).json({
          status: 400,
          message: `Negative box quantity not allowed for product ${productCodeForMsg}`,
        });
      }
    }

    if (Array.isArray(newOrderEnquiryData.lineItems)) {
      newOrderEnquiryData.lineItems = newOrderEnquiryData.lineItems.map(
        (item) => {
          const sanitized = {
            ...item,
            product: getId(item.product),
            price: getId(item.price),
            inventoryId: getId(item.inventoryId),
          };

          if (!sanitized.inventoryId) {
            delete sanitized.inventoryId;
          }

          if (sanitized._id && String(sanitized._id).startsWith("new_")) {
            delete sanitized._id;
          }

          return sanitized;
        },
      );
    }
    // Normalize manual date
    if (newOrderEnquiryData.manualDate) {
      const selectedDate = new Date(newOrderEnquiryData.manualDate);
      const now = new Date();

      selectedDate.setUTCHours(
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
        now.getUTCMilliseconds()
      );

      newOrderEnquiryData.manualDate = selectedDate;

    
    }
    const updatedOrderEnquiry = await OrderEnquiry.findOneAndUpdate(
      { _id: id },
      { $set: newOrderEnquiryData },
      { new: true, runValidators: true },
    );

    if (!updatedOrderEnquiry) {
      return res.status(400).json({
        status: 400,
        message: "Order Enquiry not edited",
      });
    }

    // ==================================================
    // RECALCULATE ORDER ENQUIRY
    // ==================================================

    let recalcError = null;
    let finalOrderEnquiry = updatedOrderEnquiry;

    try {
      const authHeader = req.headers["authorization"];

      const bearerToken =
        authHeader && authHeader.startsWith("Bearer ")
          ? authHeader.split(" ")[1]
          : null;

      const recalcToken = req.cookies?.DBToken || bearerToken;

      if (!recalcToken) {
        recalcError = "Authorization token is missing for recalculation";
      } else {
        await axios.post(
          SERVER_URL +
            `/api/v1/order-enquiry/recalculate/${updatedOrderEnquiry._id}`,
          {},
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${recalcToken}`,
            },
          }
        );

        // Reload recalculated enquiry
        const freshEnquiry = await OrderEnquiry.findById(
          updatedOrderEnquiry._id
        );

        if (freshEnquiry) {
          finalOrderEnquiry = freshEnquiry;
        }
      }
    } catch (e) {
  

      recalcError =
        "Order Enquiry edited, but recalculation failed. " +
        (e?.response?.data?.message || e.message);
    }

    return res.status(200).json({
      status: 200,
      message: "Order Enquiry edited successfully",
      data: finalOrderEnquiry,
      ...(recalcError && { recalcError }),
    });
  } catch (error) {
    res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 400);
    throw error;
  }
});

module.exports = { editOrderEnquiry };