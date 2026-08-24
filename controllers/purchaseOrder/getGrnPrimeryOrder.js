const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const getInTransitQty = require("../../utils/getInTransitQty");
const axios = require("axios");
const { SERVER_URL } = require("../../config/server.config");

const getGrnPrimeryOrder = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    let purchaseOrder = await PurchaseOrder.findById(purchaseOrderId)
      .populate([
        { path: "distributorId", select: "" },
        { path: "supplierId", select: "" },
        { path: "godownId", select: "" },
        {
          path: "lineItems.product",
          select: "",
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

    const invoices = await Invoice.find({
      purchaseOrderId: purchaseOrder._id,
    });

    const receivedMap = {};

    for (const inv of invoices) {
      for (const li of inv.lineItems) {
        const key = String(li.product);
        receivedMap[key] =
          (receivedMap[key] || 0) + Number(li.qty || 0);
      }
    }

    let lineItems = purchaseOrder?.lineItems;

    lineItems = await Promise.all(
      lineItems.map(async (item) => {
        try {
          const productId = item?.product?._id;


          const alreadyReceived =
            receivedMap[String(productId)] || 0;

          const remainingQty = Math.max(
            (item.orderQty || 0) - alreadyReceived,
            0
          );

          const piecesPerBox =
            Number(item?.product?.no_of_pieces_in_a_box || 1);

          const remainingBoxQty = Math.floor(
            remainingQty / piecesPerBox
          );

          const inTransitInvoices = await Invoice.find({
            distributorId: distributorId,
            status: "In-Transit",
          }).populate("lineItems.product");

          const intransitQty = getInTransitQty(
            inTransitInvoices,
            productId
          );

          return {
            ...item,


            existorderqty: remainingQty,
            existboxorderqty: remainingBoxQty,
            grnQty: alreadyReceived,
            grnBoxQty: Math.floor(
              alreadyReceived / piecesPerBox
            ),
            forecloseUomQty: Number(item?.forecloseUom || 0),

            inventoryId: item?.inventoryId
              ? {
                ...item?.inventoryId,
                intransitQty: intransitQty,
              }
              : null,

          };
        } catch (error) {
          console.error("Error processing item:", error);

          return {
            ...item,
            existorderqty: 0,
            existboxorderqty: 0,
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


    lineItems = await Promise.all(
      lineItems.map(async (item) => {
        try {
          const productId = item?.product?._id;

          const response = await axios.get(
            `${SERVER_URL}/api/v1/product_norm/get_product_norm_by_db_id_and_product_id/distributor/${distributorId?.toString()}/product/${productId?.toString()}`
          );

          return {
            ...item,
            productNorm: response?.data?.data || null,
          };
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
      invoiceIds: purchaseOrder?.invoiceIds || [],
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { getGrnPrimeryOrder };