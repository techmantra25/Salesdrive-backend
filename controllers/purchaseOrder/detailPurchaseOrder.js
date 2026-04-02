const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const getInTransitQty = require("../../utils/getInTransitQty");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");

// Get Purchase Order
const detailPurchaseOrder = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    let purchaseOrder = await PurchaseOrder.findById(purchaseOrderId)
      .populate([
        { path: "distributorId", select: "" },
        { path: "supplierId", select: " " },
        {
          path: "lineItems.product",
          select: " ",
          populate: [
            { path: "cat_id", select: "" },
            { path: "collection_id", select: "" },
            { path: "brand", select: "" },
          ],
        },
        { path: "lineItems.price", select: "" },
        { path: "lineItems.inventoryId", select: "" },
        { path: "approved_by", select: "" },
        { path: "updatedBy", select: "" },
        { path: "lineItems.plant", select: "" },
      ])
      .lean();

    if (!purchaseOrder) {
      res.status(404);
      throw new Error("Purchase Order not found");
    }

    const distributorId = purchaseOrder?.distributorId?._id;

    let lineItems = purchaseOrder?.lineItems;

    // fetch in-transit qty for each line item
    lineItems = await Promise.all(
      lineItems.map(async (item) => {
        try {
          // fetch in transit stock
          const inTransitInvoices = await Invoice.find({
            distributorId: distributorId,
            status: "In-Transit",
          }).populate("lineItems.product");

          const productId = item?.product?._id;

          const intransitQty = getInTransitQty(inTransitInvoices, productId);

          return {
            ...item,
            inventoryId: item?.inventoryId
              ? {
                  ...item?.inventoryId,
                  intransitQty: intransitQty,
                }
              : null,
          };
        } catch (error) {
          console.error("Error fetching in-transit qty:", error);
          return {
            ...item,
            inventoryId: item?.inventoryId
              ? {
                  ...item?.inventoryId,
                  intransitQty: 0,
                }
              : null,
          };
        }
      })
    );

    // fetch norms qty for each line item for the distributor
    lineItems = await Promise.all(
      lineItems.map(async (item) => {
        try {
          const productId = item?.product?._id;

          const response = await axios.get(
            `${SERVER_URL}/api/v1/product_norm/get_product_norm_by_db_id_and_product_id/distributor/${distributorId?.toString()}/product/${productId?.toString()}`
          );

          if (response?.data?.data) {
            return {
              ...item,
              productNorm: response?.data?.data,
            };
          } else {
            return {
              ...item,
              productNorm: null,
            };
          }
        } catch (error) {
          return {
            ...item,
            productNorm: null,
          };
        }
      })
    );

    purchaseOrder = {
      ...purchaseOrder,
      lineItems: lineItems,
    };

    res.status(200).json({
      status: 200,
      message: "Purchase Order found",
      data: purchaseOrder,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { detailPurchaseOrder };
