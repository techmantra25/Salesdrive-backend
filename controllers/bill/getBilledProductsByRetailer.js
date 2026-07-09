const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Bill = require("../../models/bill.model");

const getBilledProductsByRetailer = asyncHandler(async (req, res) => {
  try {
    const { retailerId } = req.params; // or read from req.query if you prefer
    if (!retailerId || !mongoose.Types.ObjectId.isValid(retailerId)) {
      res.status(400);
      throw new Error("Valid retailerId is required");
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { categoryId, collectionId, brandId, subBrandId, search } = req.query;

    const pipeline = [
      {
        $match: {
          retailerId: new mongoose.Types.ObjectId(retailerId),
          status: { $ne: "Cancelled" }, // drop this line if cancelled bills should count
        },
      },
      { $unwind: "$lineItems" },
      {
        $lookup: {
          from: "products", // actual Mongo collection name for the Product model
          localField: "lineItems.product",
          foreignField: "_id",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },
      { $match: { "productInfo.status": true } },
    ];

    // Category / brand / collection filters (same pattern as productListPaginated)
    const filterMatch = {};
    const idFilters = [
      { field: "productInfo.cat_id", value: categoryId },
      { field: "productInfo.collection_id", value: collectionId },
      { field: "productInfo.brand", value: brandId },
      { field: "productInfo.subBrand", value: subBrandId },
    ];
    idFilters.forEach(({ field, value }) => {
      if (value && value !== "undefined" && value !== "null") {
        filterMatch[field] = new mongoose.Types.ObjectId(value);
      }
    });
    if (Object.keys(filterMatch).length) {
      pipeline.push({ $match: filterMatch });
    }

    // Search (same token-split logic you already use)
    if (search) {
      const tokens = search.trim().split(/[\s-]+/).filter(Boolean);
      pipeline.push({
        $match: {
          $and: tokens.map((token) => ({
            $or: [
              { "productInfo.product_code": { $regex: token, $options: "i" } },
              { "productInfo.name": { $regex: token, $options: "i" } },
              { "productInfo.sku_group_id": { $regex: token, $options: "i" } },
              { "productInfo.sku_group__name": { $regex: token, $options: "i" } },
              { "productInfo.product_hsn_code": { $regex: token, $options: "i" } },
            ],
          })),
        },
      });
    }

    // Roll every line-item up per product
    pipeline.push(
      {
        $group: {
          _id: "$productInfo._id",
          product: { $first: "$productInfo" },
          totalBilledQty: { $sum: "$lineItems.billQty" },
          totalGrossAmt: { $sum: "$lineItems.grossAmt" },
          totalNetAmt: { $sum: "$lineItems.netAmt" },
          billIds: { $addToSet: "$_id" },
          billCount: { $sum: 1 },
        },
      },
      { $sort: { "product.product_code": 1 } },
      {
        $facet: {
          metadata: [{ $count: "totalFilteredCount" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                productId: "$_id",
                product: 1,
                totalBilledQty: 1,
                totalGrossAmt: 1,
                totalNetAmt: 1,
                billIds: 1,
                billCount: 1,
              },
            },
          ],
        },
      }
    );

    const [result] = await Bill.aggregate(pipeline);
    const data = result?.data || [];
    const totalFilteredCount = result?.metadata?.[0]?.totalFilteredCount || 0;

    return res.status(200).json({
      status: 200,
      message: "Billed products list paginated",
      data,
      pagination: {
        currentPage: page,
        limit,
        totalPages: Math.ceil(totalFilteredCount / limit),
        filteredCount: totalFilteredCount,
      },
    });
  } catch (error) {
    if (res.statusCode === 200) res.status(500);
    throw error;
  }
});

module.exports = { getBilledProductsByRetailer };

