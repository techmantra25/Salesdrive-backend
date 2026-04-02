const asyncHandler = require("express-async-handler");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");
const GiftOrder = require("../../models/giftOrder.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

/**
 * @desc    Distributor-wise Gift Order CSV (Distributor Login)
 * @route   GET /api/gift-orders/distributor-download-csv
 * @access  Distributor
 */
const downloadDistributorGiftOrdersCSV = asyncHandler(async (req, res) => {
  const { status, orderId } = req.query;
  const distributorId = req.user._id;

  const approvals = await DistributorGiftApproval.find(
    { distributorId },
    { giftOrderId: 1 },
  ).lean();

  if (!approvals.length) {
    return res.status(404).json({
      message: "No gift orders found for this distributor",
    });
  }

  const giftOrderIds = [
    ...new Set(approvals.map((a) => a.giftOrderId.toString())),
  ];

  const filter = {
    _id: { $in: giftOrderIds },
  };

  if (status && status !== "All") {
    filter.status = status;
  }

  if (orderId) {
    filter.orderId = { $regex: orderId, $options: "i" };
  }

  const giftOrders = await GiftOrder.find(filter)
    .populate({
      path: "retatilerRealId",
      select:
        "outletName outletCode outletUID mobile1 email address1 city pin gstin panNumber aadharNumber ownerName shipToAddress shipToPincode",
    })
    .sort({ createdAt: -1 })
    .lean();

  if (!giftOrders.length) {
    return res.status(404).json({
      message: "No gift orders found",
    });
  }

  const filename = `Distributor_Gift_Orders_${moment().format(
    "YYYY-MM-DD_HH-mm",
  )}.csv`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "text/csv");

  const csvStream = format({ headers: true });
  csvStream.pipe(res);

  const getStatusDate = (order, statusName) => {
    const statusEntry = order.statusHistory?.find(
      (item) => item.status === statusName,
    );
    return statusEntry?.updatedStatusDate
      ? moment(statusEntry.updatedStatusDate)
          .tz("Asia/Kolkata")
          .format("DD-MM-YYYY")
      : "N/A";
  };

  giftOrders.forEach((order) => {
    const outlet = order?.retatilerRealId || {};
    const shipping = order?.shippingInfo || {};

    const giftNames =
      order.orderItems
        ?.map((item) => `${item.productName} (Qty: ${item.quantity})`)
        .join(", ") || "N/A";

    csvStream.write({
      // 🏪 Outlet
      "Outlet Name": outlet.outletName || "N/A",
      "Outlet Code": outlet.outletCode || "N/A",
      "Outlet UID": outlet.outletUID || "N/A",

      // 🎁 Points & Gifts
      "Points Redeemed": order.totalRedemptionPoints || 0,
      "Gift Required": giftNames,
      "Redemption Request No": order.orderId || "N/A",

      // 📍 Address
      "Outlet Address": shipping.shippingAddress || "N/A",
      Pincode: shipping.shippingPincode || "N/A",
      city: shipping.shippingCity || "N/A",
      State: outlet.state || "N/A",

      "Owner Name": outlet.ownerName || "N/A",
      "Owner Mobile": outlet.mobile1 || "N/A",

      "Outlet GST No": outlet.gstin || "N/A",
      "Outlet Owner PAN No": outlet.panNumber || "N/A",
      "Outlet Owner Adhaar No": outlet.aadharNumber || "N/A",

      "Order Date": moment(order.createdAt)
        .tz("Asia/Kolkata")
        .format("DD-MM-YYYY"),

      "Address Confirm Date": getStatusDate(order, "Address Confirmed"),

      "Gift Order Date": getStatusDate(order, "Gift Ordered"),

      "Dispatch Date": getStatusDate(order, "Gift Dispatched"),

      "Docket No": order?.dispatchInfo?.docketNo || "N/A",

      "Delivery Date": getStatusDate(order, "Gift Delivered"),

      "Delivery Remarks": order?.deliveryRemarks || "N/A",

      "Cancelled Date": getStatusDate(order, "Cancelled"),

      "Cancelled Reason": order?.cancelReason || "N/A",
    });
  });

  csvStream.end();
});

module.exports = downloadDistributorGiftOrdersCSV;
