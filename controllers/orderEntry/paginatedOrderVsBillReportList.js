const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

// --- Row-flattening helpers (mirror the frontend's CSV builder logic) ---

const getOriginalOrderQuantity = (lineItems, product) =>
  lineItems?.find((item) => String(item.product?._id) === String(product?._id));

const getInvoiceOrderQuantity = (order, product, billNo) => {
  const bill = order?.billIds?.find((item) => item.billNo === billNo);
  return bill?.lineItems?.find(
    (item) => String(item.product?._id) === String(product?._id)
  );
};

const getSalesReturnQuantity = (order, product, billNo) => {
  const bill = order?.billIds?.find((item) => item.billNo === billNo);
  const salesReturns = bill?.salesReturnId?.filter(
    (item) => String(item.billId) === String(bill?._id)
  );
  const allLineItems = salesReturns?.flatMap((sr) => sr?.lineItems) || [];
  const returnedProducts = allLineItems?.filter(
    (item) => String(item?.product) === String(product?._id)
  );
  return {
    Quantity: returnedProducts.reduce(
      (total, item) => total + (Number(item?.returnQty) || 0),
      0
    ),
    Amount: returnedProducts.reduce(
      (total, item) => total + (Number(item?.netAmt) || 0),
      0
    ),
  };
};

const getSalesReturnData = (order, product, billNo) => {
  const bill = order?.billIds?.find((item) => item.billNo === billNo);
  const salesReturns = bill?.salesReturnId?.filter(
    (item) => String(item.billId) === String(bill?._id)
  );
  return {
    Numbers: salesReturns?.map((item) => item.salesReturnNo)?.join("|") || "",
    Dates:
      salesReturns
        ?.map((item) =>
          item?.updatedAt
            ? new Date(item.updatedAt).toISOString().slice(0, 10)
            : ""
        )
        ?.join("|") || "",
  };
};

// Flattens a single populated OrderEntry doc into one row per bill/product line item
const flattenOrderToRows = (ele) => {
  const withBillNos =
    ele?.billIds?.length > 0
      ? ele.billIds.map((bill) => ({
          ...ele.toObject ? ele.toObject() : ele,
          billNo: bill.billNo,
          billDate: bill?.updatedAt,
          billStatus: bill.status,
          new_billno: bill.new_billno,
          billIds: ele.billIds, // keep original array so bill lookups still work
        }))
      : [ele.toObject ? ele.toObject() : ele];

  const rows = withBillNos.flatMap((order) =>
    (order?.lineItems || []).map((lineItem) => {
      const rowBase = {
        ...order,
        product: lineItem?.product,
        product_price: lineItem?.price,
      };

      const originalOrder = getOriginalOrderQuantity(
        order?.lineItems,
        lineItem?.product
      );
      const invoiceOrder = getInvoiceOrderQuantity(
        order,
        lineItem?.product,
        order?.billNo
      );
      const salesReturn = getSalesReturnQuantity(
        order,
        lineItem?.product,
        order?.billNo
      );
      const salesReturnData = getSalesReturnData(
        order,
        lineItem?.product,
        order?.billNo
      );

      const orderQty = originalOrder?.oderQty || 0;
      const invoiceQty = invoiceOrder?.billQty || 0;
      const salesReturnQty = salesReturn.Quantity || 0;
      const executionPercentage =
        orderQty === 0 || rowBase?.billStatus !== "Delivered"
          ? "0%"
          : (((invoiceQty - salesReturnQty) / orderQty) * 100).toFixed(2) + "%";

      return {
        dbCode: order?.distributorId?.dbCode,
        dbName: order?.distributorId?.name,
        dbZone: order?.distributorId?.stateId?.zoneId?.name,
        dbState: order?.distributorId?.stateId?.name,
        dbCity: order?.distributorId?.city,
        godownCode: order?.godownId?.godownCode,
        godownName: order?.godownId?.godownName,
        employeeCode: order?.salesmanName?.empId,
        employeeName: order?.salesmanName?.name,
        employeeDesignation: order?.salesmanName?.desgId?.name,
        reportingManager: order?.salesmanName?.empMappingId?.rmEmpId
          ? `${order.salesmanName.empMappingId.rmEmpId.name}(${order.salesmanName.empMappingId.rmEmpId.empId})`
          : "-",
        retailerCode: order?.retailerId?.outletCode,
        retailerName: order?.retailerId?.outletName,
        beatCode: order?.routeId?.code,
        beat: order?.routeId?.name,
        orderDate: order?.updatedAt,
        orderNumber: order?.orderNo,
        orderToBillStatus:
          order.status === "Partially_Billed"
            ? "Partially Billed"
            : order.status === "Completed_Billed"
            ? "Completely Billed"
            : order.status,
        brand: lineItem?.product?.brand?.name,
        subBrand: lineItem?.product?.collection_id?.name,
        productCategory: lineItem?.product?.cat_id?.name,
        group: lineItem?.product?.sku_group__name,
        fgCode: lineItem?.product?.sku_group_id,
        productCode: lineItem?.product?.product_code,
        productName: lineItem?.product?.name,
        size: lineItem?.product?.size,
        mrp: lineItem?.price?.mrp_price,
        rlp: lineItem?.price?.rlp_price,
        originalOrderQty: originalOrder?.oderQty,
        orderQtyInBox: (
          (originalOrder?.oderQty || 0) /
          Number(lineItem?.product?.no_of_pieces_in_a_box || 1)
        ).toFixed(2),
        orderSource: order?.orderSource,
        soAmount: originalOrder?.grossAmt,
        schemeDiscount: originalOrder?.schemeDisc,
        specialDiscPercent: originalOrder?.distributorDisc,
        totalDiscPercent: originalOrder?.totalDiscountPercentage,
        orderValue: originalOrder?.netAmt,
        invoiceNumber: order?.new_billno || order?.billNo,
        invoiceDate: order?.billDate,
        invoiceStatus: order?.billStatus,
        invoiceQty: invoiceOrder?.billQty,
        invoiceValue: invoiceOrder?.netAmt,
        salesReturnNumber: salesReturnData.Numbers,
        salesReturnDate: salesReturnData.Dates,
        returnedQty: salesReturn.Quantity,
        returnedValue: salesReturn.Amount,
        executionPercentage,
      };
    })
  );

  return rows;
};

// Get Paginated Order vs Bill Report List (row-level pagination, for on-screen table)
const paginatedOrderVsBillReportList = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user._id;
    const {
      page = 1,
      limit = 20,
      orderNo,
      salesmanName,
      routeId,
      retailerId,
      orderType,
      orderSource,
      paymentMode,
      godownId,
      godownIds,
      fromDate,
      toDate,
      status,
    } = req.query;

    let query = { distributorId };

    if (orderNo) query.orderNo = { $regex: orderNo, $options: "i" };
    if (salesmanName) query.salesmanName = { $in: salesmanName.split(",") };
    if (routeId) query.routeId = { $in: routeId.split(",") };
    if (retailerId) query.retailerId = { $in: retailerId.split(",") };
    if (orderType) query.orderType = orderType;
    if (orderSource) query.orderSource = orderSource;
    if (paymentMode) query.paymentMode = paymentMode;
    if (status) query.status = status;

    if (godownId) {
      query.godownId = godownId;
    } else if (godownIds && godownIds !== "all") {
      query.godownId = { $in: godownIds.split(",").map((id) => id.trim()) };
    }

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

    // Fetch all matching orders (row count differs from order count once flattened,
    // so pagination has to happen after flattening, not at the Mongo query level).
    const orderEntries = await OrderEntry.find(query)
      .populate([
        {
          path: "distributorId",
          select: "dbCode name stateId city",
          populate: {
            path: "stateId",
            select: "name zoneId",
            populate: { path: "zoneId", select: "name" },
          },
        },
        {
          path: "godownId",
          select: "godownCode godownName godownType location isActive",
        },
        {
          path: "salesmanName",
          select: "",
          populate: [
            { path: "desgId", select: "" },
            {
              path: "empMappingId",
              select: "",
              populate: {
                path: "rmEmpId",
                select: "name empId",
              },
            },
          ],
        },
        { path: "routeId", select: "" },
        { path: "retailerId", select: "" },
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
        {
          path: "billIds",
          select: "",
          populate: [
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
            { path: "salesReturnId", select: "" },
          ],
        },
      ])
      .sort({ _id: -1 });

    const allRows = orderEntries.flatMap((order) => flattenOrderToRows(order));

    const numericPage = Math.max(Number(page) || 1, 1);
    const numericLimit = Math.max(Number(limit) || 20, 1);
    const totalRows = allRows.length;
    const totalPages = Math.max(Math.ceil(totalRows / numericLimit), 1);
    const startIndex = (numericPage - 1) * numericLimit;
    const paginatedRows = allRows.slice(startIndex, startIndex + numericLimit);

    return res.status(200).json({
      status: 200,
      message: "Order vs Bill report list",
      data: paginatedRows,
      pagination: {
        currentPage: numericPage,
        limit: numericLimit,
        totalRows,
        totalPages,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderVsBillReportList };