const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");

const paginatedBillReport = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      billNo,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      fromDate,
      toDate,
      billStatus,
      loadSheetExist,
      distributorId,
      distributorIds,
      retailerPhone,
      outletCode,
      orderType,
      paymentMode,
      brandIds,
      orderSource,
      orderStatus,
      deliveryFromDate,
      deliveryToDate,
      cancelledFromDate,
      cancelledToDate,
    } = req.query;

    console.log("Dataaaaaaaaaa", req.query);

    let query = {};

    if (loadSheetExist !== undefined && loadSheetExist !== null) {
      query.loadSheetId = { $exists: loadSheetExist === "true" };
    }

    if (billNo) query.billNo = { $regex: billNo, $options: "i" };
    if (orderNo) query.orderNo = { $regex: orderNo, $options: "i" };
    if (salesmanName) query.salesmanName = salesmanName;

    //  Route (Beat)
    if (routeId) query.routeId = routeId;

    if (retailerId) query.retailerId = retailerId;
    if (billStatus) query.status = billStatus;

    //  Created Date
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

    //  Delivery Date
    if (deliveryFromDate || deliveryToDate) {
      query["dates.deliveryDate"] = {};

      if (deliveryFromDate) {
        const start = new Date(deliveryFromDate);
        start.setHours(0, 0, 0, 0);
        query["dates.deliveryDate"].$gte = start;
      }

      if (deliveryToDate) {
        const end = new Date(deliveryToDate);
        end.setHours(23, 59, 59, 999);
        query["dates.deliveryDate"].$lte = end;
      }
    }

    //  Cancelled Date
    if (cancelledFromDate || cancelledToDate) {
      query["dates.cancelledDate"] = {};

      if (cancelledFromDate) {
        const start = new Date(cancelledFromDate);
        start.setHours(0, 0, 0, 0);
        query["dates.cancelledDate"].$gte = start;
      }

      if (cancelledToDate) {
        const end = new Date(cancelledToDate);
        end.setHours(23, 59, 59, 999);
        query["dates.cancelledDate"].$lte = end;
      }
    }

    if (retailerPhone) {
      query["retailerId.mobile1"] = retailerPhone;
    }

    if (outletCode) {
      query["retailerId.outletCode"] = outletCode;
    }

    if (orderType) query.orderType = orderType;
    if (paymentMode) query.paymentMode = paymentMode;
    if (orderSource) query["orderId.orderSource"] = orderSource;
    if (orderStatus) query["orderId.status"] = orderStatus;

    if (distributorId) {
      query.distributorId = distributorId;
    }

    if (distributorIds) {
      query.distributorId = { $in: distributorIds.split(",") };
    }

    // BRAND FILTER (NO mongoose)
    if (brandIds) {
      const brandArray = brandIds.split(",");

      const productIds = await Product.find({
        brand: { $in: brandArray },
      }).distinct("_id");



      if (productIds.length > 0) {
        query["lineItems.product"] = { $in: productIds };
      } else {
        return res.status(200).json({
          status: 200,
          message: "No data found",
          data: [],
          pagination: {
            currentPage: page,
            limit,
            totalPages: 0,
            filteredCount: 0,
            totalActiveCount: 0,
          },
        });
      }
    }



    const BillList = await Bill.find(query)
      .populate([
        {
          path: "distributorId",
          select: "dbCode name city stateId",
          populate: {
            path: "stateId",
            select: "name zoneId",
            populate: {
              path: "zoneId",
              select: "name",
            },
          },
        },
        {
          path: "salesmanName",
          select: "empId name empMappingId",
          populate: {
            path: "empMappingId",
            select: "rmEmpId",
            populate: {
              path: "rmEmpId",
              select: "empId name",
            },
          },
        },
        { path: "routeId", select: "code name" },
        { path: "orderId", select: "" },
        { path: "retailerId", select: "" },
        {
          path: "lineItems.product",
          select:
            "product_code name sku_group_id sku_group__name brand subBrand cat_id size product_hsn_code",
          populate: [
            { path: "cat_id", select: "name" },
            { path: "collection_id", select: "" },
            { path: "brand", select: "name" },
            { path: "subBrand", select: "name" },
          ],
        },
        { path: "lineItems.price", select: "" },
        { path: "lineItems.inventoryId", select: "" },
        {
          path: "loadSheetId",
          select: "allocationNo vehicleId createdAt",
          populate: {
            path: "vehicleId",
            select: "name vehicle_no ",
          },
        },
      ])
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const filteredCount = await Bill.countDocuments(query);

    let totalQuery = {};
    if (distributorId) totalQuery.distributorId = distributorId;

    if (distributorIds) {
      totalQuery.distributorId = { $in: distributorIds.split(",") };
    }

    const totalActiveCount = await Bill.countDocuments(totalQuery);

    return res.status(200).json({
      status: 200,
      message: "Bill list",
      data: BillList,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalActiveCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedBillReport };