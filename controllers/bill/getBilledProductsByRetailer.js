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

    // Roll up per product (billed side) — grab inventoryId straight from the line item
    pipeline.push(
      {
        $group: {
          _id: "$productInfo._id",
          product: { $first: "$productInfo" },
          inventoryId: { $first: "$lineItems.inventoryId" },
          totalBilledQty: { $sum: "$lineItems.billQty" },
          totalGrossAmt: { $sum: "$lineItems.grossAmt" },
          totalNetAmt: { $sum: "$lineItems.netAmt" },
          billIds: { $addToSet: "$_id" },
          billCount: { $sum: 1 },
        },
      },
      // Returned qty from SalesReturn
      {
        $lookup: {
          from: "salesreturns",
          let: { productId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$retailerId", retailerObjId] } } },
            { $unwind: "$lineItems" },
            { $match: { $expr: { $eq: ["$lineItems.product", "$$productId"] } } },
            {
              $group: {
                _id: null,
                totalReturnedQty: { $sum: "$lineItems.returnQty" },
                returnIds: { $addToSet: "$_id" },
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
        },
      },
      { $project: { returnInfo: 0 } },
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
                inventoryId: 1,
                totalBilledQty: 1,
                totalReturnedQty: 1,
                totalGrossAmt: 1,
                totalNetAmt: 1,
                billIds: 1,
                returnIds: 1,
                billCount: 1,
              },
            },
          ],
        },
      }
    );

    const [result] = await Bill.aggregate(pipeline);
    let data = result?.data || [];
    const totalFilteredCount = result?.metadata?.[0]?.totalFilteredCount || 0;

    // Batch fetch pricing for just this page's products
    if (data.length) {
      const productIds_batch = data.map((row) => row.productId.toString());
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