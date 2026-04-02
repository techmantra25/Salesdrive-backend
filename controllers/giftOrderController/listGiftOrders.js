// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");

// const listGiftOrders = asyncHandler(async (req, res) => {
//   try {
//     let { page = 1, limit = 10, status, retailer } = req.query;

//     page = parseInt(page, 10);
//     limit = parseInt(limit, 10);
//     const skip = (page - 1) * limit;

//     let filter = {};
//     if (status) filter.status = status;
//     if (retailer) filter.retailer = retailer;

//     const giftOrders = await GiftOrder.find(filter)
//       .populate({
//         path: "retailer",
//         select: "outletApprovedId",
//         populate: {
//           path: "outletApprovedId",
//           select: "outletName outletCode outletUID currentPointBalance"
//         }
//       })
//       .populate({
//         path: "products.product",
//         select: "name code point image"
//       })
//       .sort({ _id: -1 })
//       .skip(skip)
//       .limit(limit);

//     const totalCount = await GiftOrder.countDocuments();
//     const totalFilteredCount = await GiftOrder.countDocuments(filter);

//     return res.status(200).json({
//       status: 200,
//       message: "Gift orders fetched successfully",
//       data: giftOrders,
//       pagination: {
//         currentPage: page,
//         limit,
//         totalPages: Math.ceil(totalFilteredCount / limit),
//         totalCount,
//         filteredCount: totalFilteredCount,
//       },
//     });
//   } catch (error) {
//     res.status(400);
//     throw new Error(error?.message || "Something went wrong");
//   }
// });

// module.exports = listGiftOrders;


const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");
const retialer= require("../../models/outletApproved.model");
const distributorGiftApproval = require("../../models/distributorGiftApproval");

const listGiftOrders = asyncHandler(async (req, res) => {
  let { page = 1, limit = 10, status, retailer, orderId,outletID, fromDate, toDate } = req.query;
  console.log("orderId", orderId);
  console.log ("outletID", outletID)
  console.log("fromDate", fromDate, "toDate", toDate);


  page = Number(page);
  limit = Number(limit);
  const skip = (page - 1) * limit;

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

if (fromDate || toDate) {
  filter.createdAt = {};
  if (fromDate) {
    filter.createdAt.$gte = new Date(fromDate);
  }
  if (toDate) {
    filter.createdAt.$lte = new Date(toDate);
  }
}

  const [giftOrders, totalFilteredCount, totalCount] = await Promise.all([
    GiftOrder.find(filter)
      .populate({
        path: "retailer",
        select: "outletApprovedId",
        populate: {
          path: "outletApprovedId",
          select: "outletName outletCode outletUID currentPointBalance mobile1 email",
        },
      })
      .populate({
        path: "cartId",
        select: "status",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    GiftOrder.countDocuments(filter),
    GiftOrder.countDocuments(),
  ]);

  // Fetch distributor approvals for the fetched gift orders
  const giftOrderIds = giftOrders.map(go => go._id);
  const allApprovals = await distributorGiftApproval
    .find({ giftOrderId: { $in: giftOrderIds } })
    .populate({
      path: "distributorId",
      select: "name dbCode",
    })
    .sort({ createdAt: 1 });

  // Attach approvals to each gift order
  giftOrders.forEach(go => {
    go.distributorApprovals = allApprovals.filter(a => a.giftOrderId.equals(go._id));
  });

  return res.status(200).json({
    status: 200,
    message: "Gift orders fetched successfully",
    data: giftOrders,
    pagination: {
      currentPage: page,
      limit,
      totalPages: Math.ceil(totalFilteredCount / limit),
      totalCount,
      filteredCount: totalFilteredCount,
    },
  });
});

module.exports = listGiftOrders;
