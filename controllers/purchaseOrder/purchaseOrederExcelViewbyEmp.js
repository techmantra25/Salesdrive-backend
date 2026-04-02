const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Employee = require("../../models/employee.model");

const purchaseOrderExcelViewByEmp = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      fromDate,
      toDate,
      distributorId,
      approvedStatus,
      purchaseOrderId, // comma-separated _id string
      purchaseOrderNo,
    } = req.query;

    const employeeId = req.user._id;

    const employee = await Employee.findById(employeeId).select(
      "distributorId"
    );
    if (!employee) {
      res.status(404);
      throw new Error("Employee not found");
    }

    const employeeDistributors = employee.distributorId || [];
    const query = { status: "Confirmed" };

    if (approvedStatus) query.approvedStatus = approvedStatus;

    if (distributorId) {
      if (
        !employeeDistributors.map((id) => id.toString()).includes(distributorId)
      ) {
        return res.status(403).json({
          message: "You are not authorized to view this distributor's data.",
        });
      }
      query.distributorId = distributorId;
    } else {
      query.distributorId = { $in: employeeDistributors };
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (purchaseOrderId) {
      const ids = [
        ...new Set(
          purchaseOrderId
            .split(",")
            .map((id) => id.trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id))
        ),
      ];

      console.log("Parsed Purchase Order IDs:", ids);

      if (ids.length > 0) {
        query._id = { $in: ids };
      } else {
        return res.status(400).json({
          status: 400,
          error: true,
          message: "No valid purchaseOrderId(s) provided.",
        });
      }
    }

    if (purchaseOrderNo) {
      query.purchaseOrderNo = purchaseOrderNo;
    }

    const purchaseOrders = await PurchaseOrder.find(query)
      .populate([
        { path: "distributorId", select: "name dbCode" },
        { path: "supplierId", select: "supplierName" },
         {
          path: "lineItems.product",
          select: "name cat_id collection_id brand product_code no_of_pieces_in_a_box",
          populate: [
            { path: "cat_id", select: "name" },
            { path: "collection_id", select: "name" },
            { path: "brand", select: "name" },
          ],
        },
        { path: "lineItems.price", select: "dlp_price mrp_price" },
        { path: "lineItems.inventoryId", select: "availableQty intransitQty" },
         {path:"lineItems.plant",select:""},
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

    const populatedOrders = await PurchaseOrder.populate(purchaseOrders, [
      {
        path: "approved_by.desgId",
        select: "name code",
        strictPopulate: false,
      },
      {
        path: "updatedBy.desgId",
        select: "name code",
        strictPopulate: false,
      },
    ]);

    const filteredCount = await PurchaseOrder.countDocuments(query);
    const totalCount = await PurchaseOrder.countDocuments({
      status: "Confirmed",
      distributorId: { $in: employeeDistributors },
    });

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

module.exports = { purchaseOrderExcelViewByEmp };
