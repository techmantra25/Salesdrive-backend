const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

/**
 * @desc    Download Gift Orders CSV
 * @route   GET /api/admin/gift-orders/download-csv
 * @access  Admin
 */
const downloadGiftOrdersCSV = asyncHandler(async (req, res) => {
  let { status, retailer, orderId, outletID } = req.query;

  const filter = {};

  if (status && status !== "All") {
    filter.status = status;
  }

  if (retailer) {
    filter.retailer = retailer;
  }

  if (orderId) {
    filter.orderId = { $regex: orderId, $options: "i" };
  }

  if (outletID) {
    filter.retatilerRealId = outletID;
  }

  const giftOrders = await GiftOrder.find(filter)
    .populate({
      path: "retailer",
      select: "outletApprovedId",
      populate: {
        path: "outletApprovedId",
        select:
          "outletName outletCode outletUID mobile1 email address1 city pin gstin panNumber aadharNumber ownerName shipToAddress shipToPincode",
      },
    })
    .sort({ createdAt: -1 })
    .lean();

  const filename = `Gift_Orders_${moment().format("YYYY-MM-DD_HH-mm")}.csv`;

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "text/csv");

  const csvStream = format({ headers: true });
  csvStream.pipe(res);

  giftOrders.forEach((order) => {
    // Helper function to get status date from statusHistory
    const getStatusDate = (statusName) => {
      const statusEntry = order.statusHistory?.find(
        (item) => item.status === statusName,
      );
      return statusEntry?.updatedStatusDate
        ? moment(statusEntry.updatedStatusDate)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY HH:mm")
        : "N/A";
    };

    // Get gift names and quantities from orderItems
    const giftNames =
      order.orderItems
        ?.map((item) => `${item.productName} (Qty: ${item.quantity})`)
        .join(", ") || "N/A";

    // Calculate total quantity
    const totalQty =
      order.orderItems?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

    csvStream.write({
      "Outlet Name": order?.retailer?.outletApprovedId?.outletName || "N/A",
      "Outlet UID": order?.retailer?.outletApprovedId?.outletUID || "N/A",
      "Points Redeemed": order.totalRedemptionPoints || 0,
      "Gift Required": giftNames,
      "Total Qty": totalQty,
      "Redemption Request No": order.orderId || "N/A",
      "Outlet Address": order?.shippingInfo?.shippingAddress || "N/A",
      Pincode: order?.shippingInfo?.shippingPin || "N/A",
      city: order?.shippingInfo?.shippingCity || "N/A",
      State: order?.shippingInfo?.shippingState || "N/A",
      "Owner Name": order?.retailer?.outletApprovedId?.ownerName || "N/A",
      "Owner Mobile": order?.retailer?.outletApprovedId?.mobile1 || "N/A",
      "Outlet GST No": order?.retailer?.outletApprovedId?.gstin || "N/A",
      "Outlet Owner PAN No":
        order?.retailer?.outletApprovedId?.panNumber || "N/A",
      "Outlet Owner Adhaar No": order?.retailer?.outletApprovedId?.aadharNumber
        ? `'${order.retailer.outletApprovedId.aadharNumber}`
        : "N/A",
      "Order Date": moment(order.createdAt)
        .tz("Asia/Kolkata")
        .format("DD-MM-YYYY"),
      "Address Confirm Date": getStatusDate("Address Confirmed"),
      "Gift Order Date": getStatusDate("Gift Ordered"),
      "Dispatch Date": order?.dispatchInfo?.dispatchDate
        ? moment(order.dispatchInfo.dispatchDate)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY")
        : getStatusDate("Gift Dispatched"),
      "Docket No": order?.dispatchInfo?.docketNumber || "N/A",
      "Delivery Date": order?.deliveryInfo?.deliveryDate
        ? moment(order.deliveryInfo.deliveryDate)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY")
        : getStatusDate("Gift Delivered"),
      "Delivery Remarks": order?.deliveryInfo?.deliveryRemark || "N/A",
      "Cancelled Date": order?.cancellationInfo?.cancelledAt
        ? moment(order.cancellationInfo.cancelledAt)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY")
        : "N/A",
      "Cancelled Reason": order?.cancellationInfo?.reason || "N/A",
    });
  });

  csvStream.end();
});

module.exports = {
  downloadGiftOrdersCSV,
};
