const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Bill = require("../../models/bill.model");
const { getBatchProductPricing } = require("../product/utils/pricing.utils");

const getBilledProductsByRetailer = asyncHandler(async (req, res) => {
  try {
    const { retailerId } = req.params;
    if (!retailerId || !mongoose.Types.ObjectId.isValid(retailerId)) {
      res.status(400);
      throw new Error("Valid retailerId is required");
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { categoryId, collectionId, brandId, subBrandId, search } = req.query;
    const distributorIdFromUser = req?.user?._id;
    const retailerObjId = new mongoose.Types.ObjectId(retailerId);

    const pipeline = [
      {
        $match: {
          retailerId: retailerObjId,
          status: { $ne: "Cancelled" },
        },
      },
      { $unwind: "$lineItems" },
      {
        $lookup: {
          from: "products",
          localField: "lineItems.product",
          foreignField: "_id",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },
      { $match: { "productInfo.status": true } },
    ];

    // Category / brand / collection filters
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

    // Search
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

    // No grouping — one row per bill's line item.
    // Returned qty is still looked up per product only (same logic that
    // was working before), so it'll repeat identically across all bill-rows
    // for that product unless salesreturns tracks a specific billId.
    pipeline.push(
      {
        $lookup: {
          from: "salesreturns",
          // NOTE: at this point in the pipeline (after $unwind: "$lineItems" on
          // Bill), "$_id" is still the Bill document's own _id — the unwind
          // doesn't change it. So billId here correctly means "this specific bill".
          let: { productId: "$productInfo._id", billId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$retailerId", retailerObjId] } } },
            { $unwind: "$lineItems" },
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$lineItems.product", "$$productId"] },
                    { $eq: ["$lineItems.billId", "$$billId"] }, // NEW — scope to THIS bill only
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                totalReturnedQty: { $sum: "$lineItems.returnQty" },
                returnIds: { $addToSet: "$_id" },
                returnCount: { $sum: 1 },
              },
            },
          ],
          as: "returnInfo",
        },
      },
      {
        $addFields: {
          totalReturnedQty: {
            $ifNull: [{ $arrayElemAt: ["$returnInfo.totalReturnedQty", 0] }, 0],
          },
          returnIds: {
            $ifNull: [{ $arrayElemAt: ["$returnInfo.returnIds", 0] }, []],
          },
          returnCount: {
            $ifNull: [{ $arrayElemAt: ["$returnInfo.returnCount", 0] }, 0],
          },
        },
      },
      { $project: { returnInfo: 0 } },
      { $sort: { "productInfo.product_code": 1, createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "totalFilteredCount" }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                billId: "$_id",
                billNo: "$billNo",
                productId: "$productInfo._id",
                product: "$productInfo",
                inventoryId: "$lineItems.inventoryId",
                totalBilledQty: "$lineItems.billQty",  // same value, old key name
                grossAmt: "$lineItems.grossAmt",
                netAmt: "$lineItems.netAmt",
                totalReturnedQty: 1,
                returnIds: 1,
                returnCount: 1,
              },
            },
          ],
        },
      }
    );

    const [result] = await Bill.aggregate(pipeline);
    let data = result?.data || [];
    const totalFilteredCount = result?.metadata?.[0]?.totalFilteredCount || 0;

    // Batch fetch pricing — dedupe productIds since the same product can repeat across rows
    if (data.length) {
      const productIds_batch = [...new Set(data.map((row) => row.productId.toString()))];
      const pricingByProduct = await getBatchProductPricing(
        productIds_batch,
        distributorIdFromUser
      );

      data = data.map((row) => {
        const priceArray = pricingByProduct[row.productId.toString()] || [];
        const price = priceArray.length > 0 ? priceArray[0] : null;
        return { ...row, price };
      });
    }

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