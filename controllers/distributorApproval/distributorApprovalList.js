const asyncHandler = require("express-async-handler");
const DistributorGiftApproval = require("../../models/distributorGiftApproval");
const GiftOrder = require("../../models/giftOrder.model");



/**
 * Get paginated distributor gift approval list
 */
const getDistributorApprovalList = asyncHandler(async (req, res) => {
  const distributorId = req.user;

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const status = req.query.status; // Pending | Approved | Rejected
  console.log("Status",status)
  const outletApprovedId = req.query.outletApprovedId;
  const search = req.query.search;




const filter = { distributorId };

// -------------------------------
// STATUS FILTER (GiftOrder.status)
// -------------------------------
if (status && status !== "All") {
  const statusOrders = await GiftOrder.find({
    status: status,
  }).select("_id");

  const statusOrderIds = statusOrders.map(o => o._id);

  if (filter.giftOrderId) {
    // merge with existing outlet/search filters
    filter.giftOrderId.$in = filter.giftOrderId.$in.filter(id =>
      statusOrderIds.some(o => o.equals(id))
    );
  } else {
    filter.giftOrderId = { $in: statusOrderIds };
  }
}



if (outletApprovedId) {
  const matchingOrders = await GiftOrder.find({
    retatilerRealId: outletApprovedId
  }).select("_id");

  const orderIds = matchingOrders.map(o => o._id);

  filter.giftOrderId = { $in: orderIds };
}
if (search) {
  const matchingOrders = await GiftOrder.find({
    orderId: { $regex: search, $options: "i" },
  }).select("_id");

  const orderIds = matchingOrders.map((o) => o._id);

  if (filter.giftOrderId) {
    // merge with outlet filter
    filter.giftOrderId.$in = filter.giftOrderId.$in.filter(id =>
      orderIds.some(o => o.equals(id))
    );
  } else {
    filter.giftOrderId = { $in: orderIds };
  }
}


  const approvals = await DistributorGiftApproval.find(filter)
    .populate({
      path: "giftOrderId",
      select: " ",
      populate: {
        path: "retailer",
        select: "outletApprovedId",
        populate: {
          path: "outletApprovedId",
          select: "outletName outletCode outletUID city currentPointBalance",
        },
      },
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const totalRecords = await DistributorGiftApproval.countDocuments(filter);

  return res.status(200).json({
    status: 200,
    message: "Distributor approval list fetched successfully",
    data: {
      approvals,
      pagination: {
        totalRecords,
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        limit,
      },
    },
  });
});

module.exports = getDistributorApprovalList;
