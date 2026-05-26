const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");
const OutletApproved = require("../../models/outletApproved.model");

const paginatedOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user.id;

    const {
      page = 1,
      limit = 10,
      enquiryNo,
      salesmanName,
      routeId,
      retailerId,
      retailerPhone,
      outletCode,
      orderType,
      orderSource,
      paymentMode,
      fromDate,
      toDate,
      status,
    } = req.query;

    const query = { distributorId };

    if (enquiryNo) query.enquiryNo = { $regex: enquiryNo, $options: "i" };
    if (salesmanName && salesmanName !== "all") query.salesmanName = salesmanName;
    if (routeId && routeId !== "all") query.routeId = routeId;
    if (orderType && orderType !== "all") query.orderType = orderType;
    if (orderSource && orderSource !== "all") query.orderSource = orderSource;
    if (paymentMode && paymentMode !== "all") query.paymentMode = paymentMode;
    if (status && status !== "all") query.status = status;
    if (retailerId && retailerId !== "all") query.retailerId = retailerId;

    if (retailerPhone && retailerPhone !== "all") {
      const frontendDigits = retailerPhone.replace(/\D/g, "").slice(-10);
      const allRetailers = await OutletApproved.find({}, { _id: 1, mobile1: 1 });
      const matchedRetailers = allRetailers.filter((retailer) => {
        const schemaDigits = (retailer.mobile1 || "")
          .replace(/\D/g, "")
          .slice(-10);
        return schemaDigits === frontendDigits;
      });

      if (matchedRetailers.length === 0) {
        return res.status(200).json({
          status: 200,
          message: "Order enquiries list",
          data: [],
          pagination: {
            currentPage: Number(page),
            limit: Number(limit),
            totalPages: 0,
            totalCount: 0,
            filteredCount: 0,
            totalActiveCount: 0,
          },
        });
      }

      if (!retailerId || retailerId === "all") {
        query.retailerId = { $in: matchedRetailers.map((retailer) => retailer._id) };
      }
    }

    if (outletCode && outletCode !== "all") {
      const outlet = await OutletApproved.findOne({ outletCode }, { _id: 1 });

      if (!outlet) {
        return res.status(200).json({
          status: 200,
          message: "Order enquiries list",
          data: [],
          pagination: {
            currentPage: Number(page),
            limit: Number(limit),
            totalPages: 0,
            totalCount: 0,
            filteredCount: 0,
            totalActiveCount: 0,
          },
        });
      }

      if (!retailerId || retailerId === "all") {
        query.retailerId = outlet._id;
      }
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

    const orderEnquiries = await OrderEnquiry.find(query)
      .populate([
        { path: "distributorId" },
        { path: "salesmanName" },
        { path: "routeId" },
        { path: "retailerId" },
        { path: "lineItems.product" },
        { path: "lineItems.price" },
        { path: "lineItems.inventoryId" },
        { path: "convertedOrderEntryId" },
        {
          path: "adjustedCreditNoteIds.creditNoteId",
          model: "CreditNote",
          select:
            "creditNoteNo creditNoteType amount creditNoteStatus adjustedBillIds",
        },
      ])
      .sort({ _id: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const totalCount = await OrderEnquiry.countDocuments(query);

    return res.status(200).json({
      status: 200,
      message: "Order enquiries list",
      data: orderEnquiries,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / Number(limit)),
        totalCount,
        filteredCount: totalCount,
        totalActiveCount: totalCount,
      },
    });
  } catch (error) {
    console.log("Error:", error);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { paginatedOrderEnquiry };
