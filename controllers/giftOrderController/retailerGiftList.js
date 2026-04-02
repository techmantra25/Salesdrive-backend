// const asyncHandler = require("express-async-handler");
// const GiftOrder = require("../../models/giftOrder.model");

// const retailerGiftOrders = asyncHandler(async (req, res) => {
//   try {
//     let { page = 1, limit = 10, status } = req.query;

//     page = parseInt(page, 10);
//     limit = parseInt(limit, 10);
//     const skip = (page - 1) * limit;

//     let filter = {};
//     if (status) filter.status = status;

//     const outletApprovedId = req.user;

//     const giftOrders = await GiftOrder.find({ retailerRealId: outletApprovedId })
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

// module.exports = retailerGiftOrders;


const asyncHandler = require("express-async-handler");
const GiftOrder = require("../../models/giftOrder.model");

const retailerGiftOrders = asyncHandler(async (req, res) => {
  let { page = 1, limit = 10, status } = req.query;

  page = Number(page);
  limit = Number(limit);
  const skip = (page - 1) * limit;

  const outletApprovedId = req.user;

  const filter = {
    retatilerRealId: outletApprovedId,
  };

  if (status) {
    filter.status = status;
  }

  const [giftOrders, totalFilteredCount] = await Promise.all([
    GiftOrder.find(filter)
      .populate({
        path: "retailer",
        select: "outletApprovedId",
        populate: {
          path: "outletApprovedId",
          select: "outletName outletCode outletUID",
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
  ]);

  return res.status(200).json({
    status: 200,
    message: "Retailer gift orders fetched successfully",
    data: giftOrders,
    pagination: {
      currentPage: page,
      limit,
      totalPages: Math.ceil(totalFilteredCount / limit),
      totalCount: totalFilteredCount,
    },
  });
});

module.exports = retailerGiftOrders;
