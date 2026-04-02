const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");

// Paginated Purchase Order Entry Report with Filters
const paginatedPurchaseOrderList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate,
      distributorId,
      approvedStatus,
      purchaseOrderNo,
    } = req.query;

    let query = {};

    // Filter by status
    if (status) query.status = status;

    if (approvedStatus) {
      query.approvedStatus = approvedStatus;
    }

    if (purchaseOrderNo) {
      // or condition
      query.$or = [
        { purchaseOrderNo: new RegExp(purchaseOrderNo, "i") },
        { "sapStatusData.Vbeln": new RegExp(purchaseOrderNo, "i") },
        { "sapStatusData.Vbelnso": new RegExp(purchaseOrderNo, "i") },
      ];
    }

    // Filter by distributor
    if (distributorId) query.distributorId = distributorId;

    // Filter by date range (createdAt)
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        query.createdAt.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endOfDay;
      }
    }

    // Fetch data with pagination
    const purchaseOrders = await PurchaseOrder.find(query)
      .populate([
        { path: "distributorId", select: "name dbCode" },
        { path: "supplierId", select: "supplierName supplierCode" },
        {
          path: "lineItems.product",
          select: "name cat_id collection_id brand",
          populate: [
            { path: "cat_id", select: "name" },
            { path: "collection_id", select: "name" },
            { path: "brand", select: "name" },
          ],
        },
        { path: "lineItems.price", select: "amount" },
        { path: "lineItems.inventoryId", select: "batchNo qtyAvailable" },
        { path: "lineItems.plant", select: "" },
        {
          path: "updatedBy",
          select: "name empId dbCode desgId",
          strictPopulate: false,
        },
        {
          path: "approved_by",
          select: "name empId desgId",
          strictPopulate: false,
        },
      ])
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Optional: Manually populate desgId for Employee types
    const populatedOrders = await PurchaseOrder.populate(purchaseOrders, [
      {
        path: "updatedBy.desgId",
        select: "name code",
        strictPopulate: false,
      },
      {
        path: "approved_by.desgId",
        select: "name code",
        strictPopulate: false,
      },
    ]);

    const filteredCount = await PurchaseOrder.countDocuments(query);
    totalQuery = {};
    if (distributorId) {
      totalQuery.distributorId = distributorId;
    }
    const totalCount = await PurchaseOrder.countDocuments(totalQuery);

    res.status(200).json({
      status: 200,
      message: "Purchase orders list",
      data: populatedOrders,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedPurchaseOrderList };
