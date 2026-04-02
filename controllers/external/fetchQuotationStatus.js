const asyncHandler = require("express-async-handler");
const PurchaseOrderEntry = require("../../models/purchaseOrder.model");
const axios = require("axios");
const { releaseLock, acquireLock } = require("../../models/lock.model");
const notificationQueue = require("../../queues/notificationQueue");

const formattedDate = (date) => {
  if (date instanceof Date && !isNaN(date)) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }
  return "";
};

const fetchQuotationStatus = asyncHandler(async (req, res) => {
  if (!(await acquireLock("fetchQuotationStatus"))) {
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }

  try {
    let purchaseOrderIds = [];

    if (
      req.body &&
      req.body.purchaseOrderIds &&
      Array.isArray(req.body.purchaseOrderIds) &&
      req.body.purchaseOrderIds.length > 0
    ) {
      purchaseOrderIds = req.body.purchaseOrderIds;
    } else {
      let query = {
        quotationSuccess: true,
      };

      if (req.body.distributorId && req.body.distributorId !== "") {
        query.distributorId = req.body.distributorId;
      }

      const purchaseOrdersWithIds = await PurchaseOrderEntry.find(query).select(
        "_id"
      );
      purchaseOrderIds = purchaseOrdersWithIds.map((po) => po._id.toString());
    }

    console.log("Purchase Order IDs Length:", purchaseOrderIds.length);

    // Counters
    let foundCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    // Fetch all purchase orders in one go
    const purchaseOrders = await PurchaseOrderEntry.find({
      _id: { $in: purchaseOrderIds },
    })
      .populate([
        { path: "distributorId", select: "" },
        { path: "supplierId", select: "" },
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

    // Map for quick access
    const purchaseOrderMap = {};
    purchaseOrders.forEach((po) => {
      purchaseOrderMap[po._id.toString()] = po;
    });

    // Process all in parallel
    const distributorNotifications = new Map();

    await Promise.all(
      purchaseOrderIds.map(async (purchaseOrderId) => {
        const purchaseOrder = purchaseOrderMap[purchaseOrderId];
        if (!purchaseOrder) {
          errorCount++;
          return;
        }

        const purchaseOrderNo = purchaseOrder.purchaseOrderNo;
        const date = purchaseOrder.createdAt;
        const dbCode = purchaseOrder.distributorId?.dbCode;
        const distributorId = purchaseOrder.distributorId?._id.toString();

        let previousDate = new Date(date);
        previousDate.setDate(previousDate.getDate() - 1);
        previousDate = formattedDate(previousDate);

        let nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 7);
        nextDate = formattedDate(nextDate);

        const url = `http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_MASSIST_QUOT_STATUS1_SRV/QuotHeaderSet(FromDate='${previousDate}',ToDate='${nextDate}',Kunnr='${dbCode}')/HeaderItem?$format=json`;

        try {
          const response = await axios.get(url, {
            headers: {
              Cookie: "sap-usercontext=sap-client=100",
            },
          });

          const data = response.data?.d?.results || [];
          const statusData = data.find(
            (item) => item.Bstnk === purchaseOrderNo
          );

          if (statusData) {
            foundCount++;
            await PurchaseOrderEntry.findByIdAndUpdate(purchaseOrderId, {
              sapStatus: statusData.Status,
              sapStatusData: statusData,
            });

            // Track notification for distributor
            if (distributorId) {
              const key = `${distributorId}_${statusData.Status}`;
              if (!distributorNotifications.has(key)) {
                distributorNotifications.set(key, {
                  distributorId,
                  status: statusData.Status,
                  purchaseOrders: [],
                });
              }
              distributorNotifications.get(key).purchaseOrders.push(purchaseOrderNo);
            }
          } else {
            notFoundCount++;
            await PurchaseOrderEntry.findByIdAndUpdate(purchaseOrderId, {
              sapStatus: "Not Found",
              sapStatusData: null,
            });
          }
        } catch (err) {
          errorCount++;
          await PurchaseOrderEntry.findByIdAndUpdate(purchaseOrderId, {
            sapStatus: "Error Fetching",
            sapStatusData: null,
          });
        }
      })
    );

    // Send notifications to distributors
    for (const [key, notificationData] of distributorNotifications.entries()) {
      const { distributorId, status, purchaseOrders } = notificationData;
      const poList = purchaseOrders.slice(0, 5).join(", ");
      const moreCount = purchaseOrders.length > 5 ? purchaseOrders.length - 5 : 0;
      const message = `Quotation status updated for ${purchaseOrders.length} PO(s): ${poList}${moreCount > 0 ? ` and ${moreCount} more` : ""}. Status: ${status}`;
      
      await notificationQueue.add("quotationStatus", {
        type: "purchaseOrder",
        data: {
          message,
          title: "Quotation Status Updated",
          status,
          purchaseOrderCount: purchaseOrders.length,
          purchaseOrders: purchaseOrders.slice(0, 5),
        },
        userId: distributorId,
        userType: "Distributor",
      });
    }

    res.status(200).json({
      message: "Quotation status fetched successfully",
      data: {
        purchaseOrderIds,
        foundCount,
        notFoundCount,
        errorCount,
      },
    });
  } catch (error) {
    res.status(500);
    throw error;
  } finally {
    await releaseLock("fetchQuotationStatus");
  }
});

module.exports = { fetchQuotationStatus };
