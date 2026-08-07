const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");

const paginatedSalesOrderList = asyncHandler(async (req, res) => {
  const {
    distributorIds,
    search,
    orderSource,
    status,
    paymentMode,
    fromDate,
    toDate,
    salesmanName,
    routeId,
    retailerId,
    page = 1,
    limit = 20,
  } = req.query;

  // -------------------- FILTERS (same shape as generateSalesOrderReport) --------------------
  const filter = {};

  if (distributorIds) {
    filter.distributorId = { $in: distributorIds.split(",") };
  }
  if (salesmanName) {
    filter.salesmanName = { $in: salesmanName.split(",") };
  }
  if (routeId) {
    filter.routeId = { $in: routeId.split(",") };
  }
  if (retailerId) {
    filter.retailerId = { $in: retailerId.split(",") };
  }
  if (search) {
    filter.orderNo = new RegExp(search, "i");
  }
  if (orderSource && orderSource !== "all") {
    filter.orderSource = orderSource;
  }
  if (status && status !== "all") {
    filter.status = status;
  }
  if (paymentMode && paymentMode !== "all") {
    filter.paymentMode = paymentMode;
  }
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) {
      const start = new Date(fromDate);
      start.setHours(0, 0, 0, 0);
      filter.createdAt.$gte = start;
    }
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  // -------------------- PAGINATION --------------------
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 20);
  const skip = (pageNum - 1) * limitNum;

  const populateFields = [
    { path: "distributorId", select: "dbCode name" },
    {
      path: "salesmanName",
      select: "empId name",
    },
    { path: "routeId", select: "code name" },
    { path: "retailerId", select: "outletCode outletName" },
    {
      path: "lineItems.product",
      select:
        "product_code name sku_group_id sku_group__name no_of_pieces_in_a_box brand subBrand cat_id product_type",
      populate: [
        { path: "brand", select: "name" },
        { path: "subBrand", select: "name" },
        { path: "cat_id", select: "name" },
      ],
    },
    { path: "lineItems.price", select: "mrp_price rlp_price" },
    {
      path: "lineItems",
      select: "oderQty grossAmt schemeDisc distributorDisc netAmt",
    },
  ];

  const [totalCount, orders] = await Promise.all([
    OrderEntry.countDocuments(filter),
    OrderEntry.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  // -------------------- SHAPE — ONE ROW PER PRODUCT LINE ITEM --------------------
  // Matches the requested table columns exactly: Order Number, Order Date,
  // Order Source, Salesman Code, Salesman Name, Beat Code, Beat, Retailer Code,
  // Retailer, Brand, Product Type, Category, Product Code, Product Name,
  // Order Qty (Pcs), Order Qty (BOX), MRP, RLP, Gross Amount,
  // Freight And Delivery Charges, Handling Charges, Scheme Discount,
  // Special Disc Amount, Total Disc %, Basic Amount, Net Amount (Incl. Amt),
  // Order to Bill Status.
  const data = orders.flatMap((order) => {
    const lineItems = order.lineItems || [];

    const statusLabel =
      order.status === "Partially_Billed"
        ? "Partially Billed"
        : order.status === "Completed_Billed"
          ? "Completely Billed"
          : order.status;

    if (lineItems.length === 0) {
      // Still surface the order even if it has no line items yet.
      return [
        {
          rowId: `${order._id}`,
          orderNo: order.orderNo || "",
          orderDate: order.updatedAt,
          orderSource: order.orderSource || "",
          salesmanCode: order.salesmanName?.empId || "",
          salesmanNameLabel: order.salesmanName?.name || "",
          beatCode: order.routeId?.code || "",
          beatName: order.routeId?.name || "",
          retailerCode: order.retailerId?.outletCode || "",
          retailerName: order.retailerId?.outletName || "",
          brand: "",
          productType: "",
          category: "",
          productCode: "",
          productName: "",
          qtyPcs: 0,
          qtyBox: 0,
          mrp: 0,
          rlp: 0,
          grossAmt: 0,
          freightCharges: order.freightCharges || 0,
          handlingCharges: order.handlingCharges || 0,
          schemeDisc: 0,
          distributorDisc: 0,
          totalDiscPercent: 0,
          basicAmt: 0,
          netAmt: 0,
          statusLabel,
        },
      ];
    }

    return lineItems.map((item, idx) => {
      const qtyPcs = item?.oderQty || 0;
      const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box || 1);
      const grossAmt = item?.grossAmt || 0;

      return {
        rowId: `${order._id}-${idx}`,
        orderNo: order.orderNo || "",
        orderDate: order.updatedAt,
        orderSource: order.orderSource || "",
        salesmanCode: order.salesmanName?.empId || "",
        salesmanNameLabel: order.salesmanName?.name || "",
        beatCode: order.routeId?.code || "",
        beatName: order.routeId?.name || "",
        retailerCode: order.retailerId?.outletCode || "",
        retailerName: order.retailerId?.outletName || "",
        brand: item?.product?.brand?.name || "",
        productType: item?.product?.product_type || "",
        category: item?.product?.cat_id?.name || "",
        productCode: item?.product?.product_code || "",
        productName: item?.product?.name || "",
        qtyPcs,
        qtyBox: Number((qtyPcs / piecesPerBox).toFixed(2)),
        mrp: item?.price?.mrp_price || 0,
        rlp: item?.price?.rlp_price || 0,
        grossAmt,
        freightCharges: order.freightCharges || 0,
        handlingCharges: order.handlingCharges || 0,
        schemeDisc: item?.schemeDisc || 0,
        distributorDisc: item?.distributorDisc || 0,
        totalDiscPercent: item?.totalDiscountPercentage
          ? Number(Number(item.totalDiscountPercentage).toFixed(2))
          : 0,
        basicAmt: Number(grossAmt.toFixed ? grossAmt.toFixed(2) : grossAmt),
        netAmt: Number(item?.netAmt || 0).toFixed(2),
        statusLabel,
      };
    });
  });

  res.status(200).json({
    success: true,
    data,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limitNum)),
    },
  });
});

module.exports = { paginatedSalesOrderList };