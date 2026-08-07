const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");
const Product = require("../../models/product.model");

// Returns one row per bill line item, paginated. Mirrors the flattening
// logic used by the frontend's CSV export (BillDumpReport.jsx) so the
// on-screen list and the downloaded report always agree field-for-field.
const paginatedBillListReport = asyncHandler(async (req, res) => {
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
      distributorId,
      distributorIds,
      orderType,
      paymentMode,
      orderSource,
      brandIds,
    } = req.query;

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.max(Number(limit) || 10, 1);

    let query = {};

    if (billNo) query.billNo = { $regex: billNo, $options: "i" };
    if (orderNo) query.orderNo = { $regex: orderNo, $options: "i" };

    if (salesmanName) query.salesmanName = { $in: salesmanName.split(",") };
    if (routeId) query.routeId = { $in: routeId.split(",") };
    if (retailerId) query.retailerId = { $in: retailerId.split(",") };

    if (billStatus) query.status = billStatus;
    if (orderType) query.orderType = orderType;
    if (paymentMode) query.paymentMode = paymentMode;
    if (orderSource) query["orderId.orderSource"] = orderSource;

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

    if (distributorId) query.distributorId = distributorId;
    if (distributorIds) query.distributorId = { $in: distributorIds.split(",") };

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
          pagination: { currentPage: pageNum, limit: limitNum, totalPages: 0, totalRows: 0 },
        });
      }
    }

    // NOTE: we pull every matching bill (fully populated) rather than
    // skip/limit at the bill level, because a single bill can contain many
    // line items and we want consistent, exact page sizes at the row level.
    // If this table grows very large, consider requiring a date range on
    // this endpoint (the CSV export already enforces one) to bound the query.
    const bills = await Bill.find(query)
      .populate([
        {
          path: "distributorId",
          populate: {
            path: "stateId",
            select: "name zoneId",
            populate: { path: "zoneId", select: "name" },
          },
        },
        {
          path: "salesmanName",
          populate: {
            path: "empMappingId",
            select: "rmEmpId",
            populate: { path: "rmEmpId", select: "empId name" },
          },
        },
        { path: "routeId" },
        { path: "orderId" },
        { path: "retailerId" },
        {
          path: "lineItems.product",
          populate: [
            { path: "cat_id" },
            { path: "collection_id" },
            { path: "brand", select: "name" },
            { path: "subBrand", select: "name" },
          ],
        },
        { path: "lineItems.price" },
        { path: "lineItems.inventoryId" },
        {
          path: "loadSheetId",
          select: "allocationNo vehicleId createdAt",
          populate: { path: "vehicleId", select: "name vehicle_no" },
        },
      ])
      .sort({ _id: -1 });

    const rows = [];

    bills.forEach((bill) => {
      const lineItems = (bill.lineItems || []).filter(
        (item) => item?.itemBillType !== "Item Removed"
      );

      lineItems.forEach((item, idx) => {
        rows.push({
          rowId: `${bill._id}_${item._id || idx}`,
          billNo: bill?.new_billno || bill.billNo,
          billDate: bill.createdAt,
          billStatus: bill.status,
          orderNo: bill.orderNo,
          orderDate: bill?.orderId?.createdAt,
          allocationNo: bill?.loadSheetId?.allocationNo,
          vehicleNo: bill?.loadSheetId?.vehicleId?.vehicle_no,
          distributorName: bill.distributorId?.name,
          distributorCode: bill.distributorId?.dbCode,
          distributorState: bill?.distributorId?.stateId?.name,
          distributorCity: bill?.distributorId?.city,
          salesmanEmpId: bill.salesmanName?.empId,
          salesmanName: bill.salesmanName?.name,
          reportingManager: bill?.salesmanName?.empMappingId?.rmEmpId?.name
            ? `${bill.salesmanName.empMappingId.rmEmpId.name}(${bill.salesmanName.empMappingId.rmEmpId.empId})`
            : "",
          routeCode: bill.routeId?.code,
          routeName: bill.routeId?.name,
          retailerCode: bill.retailerId?.outletCode,
          retailerName: bill.retailerId?.outletName,
          productCode: item.product?.product_code,
          productName: item.product?.name,
          skuGroupCode: item.product?.sku_group_id,
          skuGroupName: item.product?.sku_group__name,
          categoryName: item.product?.cat_id?.name,
          collectionName: item.product?.collection_id?.name,
          brandName: item.product?.brand?.name,
          subBrandName: item?.product?.subBrand?.name,
          size: item.product?.size,
          hsnCode: item.product?.product_hsn_code,
          uom: item.uom,
          rlp: item.price?.rlp_price,
          dlp: item.price?.dlp_price,
          mrp: item.price?.mrp_price,
          orderQtyPcs: item?.oderQty,
          orderQtyBox:
            Number(item?.oderQty || 0) /
            Number(item?.product?.no_of_pieces_in_a_box || 1),
          billQty: item?.billQty,
          grossAmt: item?.grossAmt,
          schemeDisc: item?.schemeDisc,
          specialDiscPercent: item?.distributorDisc,
          soAmt: item?.taxableAmt,
          cgst: item?.totalCGST,
          sgst: item?.totalSGST,
          igst: item?.totalIGST,
          totalDiscPercent: item?.totalDiscountPercentage,
          freightCharges: idx === 0 ? bill?.freightCharges || 0 : "",
          handlingCharges: idx === 0 ? bill?.handlingCharges || 0 : "",
          netAmt: item?.netAmount,
          totalBillValue: bill?.netAmount,
          goodsType: item?.goodsType,
          remark: item?.remark,
        });
      });
    });

    const totalRows = rows.length;
    const totalPages = Math.max(Math.ceil(totalRows / limitNum), 1);
    const startIdx = (pageNum - 1) * limitNum;
    const pagedRows = rows.slice(startIdx, startIdx + limitNum);

    return res.status(200).json({
      status: 200,
      message: "Bill list report",
      data: pagedRows,
      pagination: {
        currentPage: pageNum,
        limit: limitNum,
        totalPages,
        totalRows,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedBillListReport };