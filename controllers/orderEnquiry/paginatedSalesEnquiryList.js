const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");

const paginatedSalesEnquiryList = asyncHandler(async (req, res) => {
  const {
    distributorIds,
    search,
    orderSource,
    status,
    paymentMode,
    fromDate,
    toDate,
    routeId,
    retailerId,
    page = 1,
    limit = 20,
  } = req.query;

  // -------------------- FILTERS (same shape as generateSalesEnquiryReport) --------------------
  const filter = {};

  if (distributorIds) {
    filter.distributorId = { $in: distributorIds.split(",") };
  }
  if (routeId) {
    filter.routeId = { $in: routeId.split(",") };
  }
  if (retailerId) {
    filter.retailerId = { $in: retailerId.split(",") };
  }
  if (search) {
    filter.enquiryNo = new RegExp(search, "i");
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
    {
      path: "distributorId",
      select: "dbCode name stateId city",
      populate: {
        path: "stateId",
        select: "name zoneId",
        populate: {
          path: "zoneId",
          select: "name",
        },
      },
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
    { path: "convertedOrderEntryId", select: "orderNo" },
  ];

  const [totalCount, enquiries] = await Promise.all([
    OrderEnquiry.countDocuments(filter),
    OrderEnquiry.find(filter)
      .populate(populateFields)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  // -------------------- SHAPE — ONE ROW PER PRODUCT LINE ITEM --------------------
  // Matches the requested table columns exactly: Enquiry Number, Enquiry Date,
  // Order Source, Beat Code, Beat, Retailer Code, Retailer, Brand, Product Type,
  // Category, Product Code, Product Name, Order Qty (Pcs), Order Qty (BOX), MRP,
  // RLP, Gross Amount, Freight And Delivery Charges, Handling Charges,
  // Scheme Discount, Special Disc Amount, Total Disc %, Net Amount (Incl. Amt),
  // Enquiry to Order Status, Converted Order No.
  const data = enquiries.flatMap((enquiry) => {
    const lineItems = enquiry.lineItems || [];

    const statusLabel =
      enquiry.status === "Converted"
        ? "Converted"
        : enquiry.status === "Closed"
          ? "Closed"
          : enquiry.status;

    if (lineItems.length === 0) {
      // Still surface the enquiry even if it has no line items yet.
      return [
        {
          rowId: `${enquiry._id}`,
          enquiryNo: enquiry.enquiryNo || "",
          enquiryDate: enquiry.updatedAt,
          orderSource: enquiry.orderSource || "",
          beatCode: enquiry.routeId?.code || "",
          beatName: enquiry.routeId?.name || "",
          retailerCode: enquiry.retailerId?.outletCode || "",
          retailerName: enquiry.retailerId?.outletName || "",
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
          freightCharges: enquiry.freightCharges || 0,
          handlingCharges: enquiry.handlingCharges || 0,
          schemeDisc: 0,
          distributorDisc: 0,
          totalDiscPercent: 0,
          netAmt: 0,
          statusLabel,
          convertedOrderNo: enquiry.convertedOrderEntryId?.orderNo || "",
        },
      ];
    }

    return lineItems.map((item, idx) => {
      const qtyPcs = item?.oderQty || 0;
      const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box || 1);

      return {
        rowId: `${enquiry._id}-${idx}`,
        enquiryNo: enquiry.enquiryNo || "",
        enquiryDate: enquiry.updatedAt,
        orderSource: enquiry.orderSource || "",
        beatCode: enquiry.routeId?.code || "",
        beatName: enquiry.routeId?.name || "",
        retailerCode: enquiry.retailerId?.outletCode || "",
        retailerName: enquiry.retailerId?.outletName || "",
        brand: item?.product?.brand?.name || "",
        productType: item?.product?.product_type || "",
        category: item?.product?.cat_id?.name || "",
        productCode: item?.product?.product_code || "",
        productName: item?.product?.name || "",
        qtyPcs,
        qtyBox: Number((qtyPcs / piecesPerBox).toFixed(2)),
        mrp: item?.price?.mrp_price || 0,
        rlp: item?.price?.rlp_price || 0,
        grossAmt: item?.grossAmt || 0,
        freightCharges: enquiry.freightCharges || 0,
        handlingCharges: enquiry.handlingCharges || 0,
        schemeDisc: item?.schemeDisc || 0,
        distributorDisc: item?.distributorDisc || 0,
        totalDiscPercent: item?.totalDiscountPercentage
          ? Number(Number(item.totalDiscountPercentage).toFixed(2))
          : 0,
        netAmt: item?.netAmt || 0,
        statusLabel,
        convertedOrderNo: enquiry.convertedOrderEntryId?.orderNo || "",
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

module.exports = { paginatedSalesEnquiryList };