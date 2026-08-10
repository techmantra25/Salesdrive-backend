const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const mongoose = require("mongoose");
const Transaction = require("../../models/transaction.model");
const Invoice = require("../../models/invoice.model");
const Distributor = require("../../models/distributor.model");
const getInTransitQty = require("../../utils/getInTransitQty");

// Maps frontend sort keys -> actual field paths in the aggregation pipeline.
// Paths under "product." only exist after the $unwind stage.
// "basePointTotal" is a computed field added via $addFields (see below).
const SORTABLE_FIELDS = {
  product_code: "product.product_code",
  size: "product.size",
  product: "product.name",
  availableQty: "availableQty",
  unsalableQty: "unsalableQty",
  intransitQty: "intransitQty",
  totalStockamtDlp: "totalStockamtDlp",
  totalUnsalableamtDlp: "totalUnsalableamtDlp",
  totalStockamtRlp: "totalStockamtRlp",
  totalUnsalableStockamtRlp: "totalUnsalableStockamtRlp",
  reservedQty: "reservedQty",
  normsQty: "normsQty",
  basePoint: "basePointTotal",
};

// closingStockCount is intentionally NOT in SORTABLE_FIELDS: it's derived
// from a per-item Transaction lookup that runs AFTER pagination/skip/limit,
// so it can't be sorted across the full result set without querying every
// matching inventory row's transaction history up front (expensive). It
// remains page-local only; see handleSort in InventoryTable.jsx.

const inventoryPaginatedList = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      productId,
      searchTerm,
      brandId,
      categoryId,
      collectionId,
      godownType,
      closingStockDate,
      stockType,
      showZeroStock,
      sortField,
      sortOrder,
    } = req.query;

    const distributorId = req.user._id;

    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Build the aggregation pipeline
    const pipeline = [];

    // Match filters for inventory
    const matchStage = {
      distributorId: distributorId,
    };

    if (godownType) {
      matchStage.godownType = godownType;
    }

    const showZeroStockBool = showZeroStock === "true" || showZeroStock === true;

    if (!showZeroStockBool) {
      if (stockType === "salable") {
        matchStage.$or = [
          { availableQty: { $gt: 0 } },
          { reservedQty: { $gt: 0 } },
        ];
      } else if (stockType === "unsalable") {
        matchStage.unsalableQty = { $gt: 0 };
      } else if (stockType === "reserve") {
        matchStage.reservedQty = { $gt: 0 };
      }
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Lookup (join) with the Product model to apply product-specific filters
    pipeline.push({
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    });

    // Unwind the product array (since $lookup returns an array)
    pipeline.push({
      $unwind: "$product",
    });

    // Apply filters on the product fields
    const productMatchStage = {};

    if (productId) {
      productMatchStage["product._id"] = new mongoose.Types.ObjectId(productId);
    }

    if (searchTerm) {
      const tokens = searchTerm.trim().split(/\s+/).filter(Boolean);

      productMatchStage["$and"] = tokens.map((token) => ({
        $or: [
          { "product.product_code": { $regex: token, $options: "i" } },
          { "product.name": { $regex: token, $options: "i" } },
        ],
      }));
    }

    if (brandId) {
      productMatchStage["product.brand"] = new mongoose.Types.ObjectId(brandId);
    }

    if (categoryId) {
      productMatchStage["product.cat_id"] = new mongoose.Types.ObjectId(
        categoryId
      );
    }

    if (collectionId) {
      productMatchStage["product.collection_id"] = new mongoose.Types.ObjectId(
        collectionId
      );
    }

    if (Object.keys(productMatchStage).length > 0) {
      pipeline.push({ $match: productMatchStage });
    }

    // Lookup (join) with the Distributor model
    pipeline.push({
      $lookup: {
        from: "distributors",
        localField: "distributorId",
        foreignField: "_id",
        as: "distributor",
      },
    });

    // basePoint isn't a stored field — compute it here so it can be sorted
    // the same way it's calculated on the frontend:
    // product.base_point * (availableQty + reservedQty)
    pipeline.push({
      $addFields: {
        basePointTotal: {
          $multiply: [
            {
              $convert: {
                input: "$product.base_point",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            {
              $add: [
                { $convert: { input: "$availableQty", to: "double", onError: 0, onNull: 0 } },
                { $convert: { input: "$reservedQty", to: "double", onError: 0, onNull: 0 } },
              ],
            }
          ],
        },
      },
    });

    // Sort: whitelist-driven, defaults to product name ascending.
    // _id is a tiebreaker so pagination stays stable when many rows share
    // the same sort value.
    const sortDirection = sortOrder === "desc" ? -1 : 1;
    const sortKey = SORTABLE_FIELDS[sortField] || "product.name";
    pipeline.push({ $sort: { [sortKey]: sortDirection, _id: 1 } });

    // Pagination: Skip and limit
    const paginatedPipeline = [...pipeline];
    paginatedPipeline.push({ $skip: (pageNum - 1) * limitNum });
    paginatedPipeline.push({ $limit: limitNum });

    // Total count for all items (no filters applied)
    const totalCountPipeline = [
      {
        $match: {
          distributorId: distributorId,
        },
      },
      {
        $count: "totalItems",
      },
    ];

    // Count total items matching current filters
    // (sort doesn't affect count, but reuse pipeline up to before $sort is
    // unnecessary — $sort has no effect on $count either way)
    const filteredCountPipeline = [
      ...pipeline,
      {
        $count: "totalFilteredItems",
      },
    ];

    // Get distributor info to check RBP scheme mapping
    const distributor = await Distributor.findById(distributorId).select(
      "RBPSchemeMapped"
    );

    // Execute all pipelines concurrently
    let [inventories, totalCountResult, filteredCountResult] =
      await Promise.all([
        Inventory.aggregate(paginatedPipeline),
        Inventory.aggregate(totalCountPipeline),
        Inventory.aggregate(filteredCountPipeline),
      ]);

    const totalItems =
      totalCountResult.length > 0 ? totalCountResult[0].totalItems : 0;
    const totalFilteredItems =
      filteredCountResult.length > 0
        ? filteredCountResult[0].totalFilteredItems
        : 0;
    const totalPages = Math.ceil(totalFilteredItems / limitNum);

    if (closingStockDate && stockType) {
      let endDate = new Date(closingStockDate);
      endDate.setHours(23, 59, 59, 999);

      inventories = await Promise.all(
        inventories.map(async (invItem) => {
          const transactions = await Transaction.find({
            $and: [
              { distributorId: distributorId },
              { productId: invItem.productId },
              { createdAt: { $lt: endDate } },
              { stockType: stockType },
            ],
          }).sort({ createdAt: -1 });

          if (transactions.length > 0) {
            const lastTransaction = transactions[0];
            return {
              ...invItem,
              closingStockCount: lastTransaction?.balanceCount,
            };
          } else {
            return {
              ...invItem,
              closingStockCount: null,
            };
          }
        })
      );
    }

    const resultInventories = inventories;

    // Calculate currentStockTotalPoints if conditions are met
    let currentStockTotalPoints = null;

    if (distributor?.RBPSchemeMapped === "yes" && stockType === "salable") {
      const pointsCalculationPipeline = [
        {
          $match: {
            distributorId: distributorId,
            $or: [{ availableQty: { $gt: 0 } }, { reservedQty: { $gt: 0 } }],
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "productId",
            foreignField: "_id",
            as: "product",
          },
        },
        {
          $unwind: "$product",
        },
      ];

      if (Object.keys(productMatchStage).length > 0) {
        pointsCalculationPipeline.push({ $match: productMatchStage });
      }

      const allInventoriesForPoints = await Inventory.aggregate(
        pointsCalculationPipeline
      );

      currentStockTotalPoints = allInventoriesForPoints.reduce(
        (totalPoints, invItem) => {
          const basePoint = parseFloat(invItem.product?.base_point) || 0;
          const availableQty = Number(invItem.availableQty) || 0;
          const reservedQty = Number(invItem.reservedQty) || 0;
          const totalQty = availableQty + reservedQty;
          const productPoints = basePoint * totalQty;

          return totalPoints + productPoints;
        },
        0
      );
    }

    // Build pagination object
    const pagination = {
      currentPage: pageNum,
      limit: limitNum,
      totalPages,
      totalCount: totalItems,
      filteredCount: totalFilteredItems,
    };

    if (
      distributor?.RBPSchemeMapped === "yes" &&
      currentStockTotalPoints !== null
    ) {
      pagination.currentStockTotalPoints = currentStockTotalPoints;
    }

    return res.status(200).json({
      status: 200,
      message: "Inventories fetched successfully",
      data: inventories,
      pagination,
    });
  } catch (error) {
    res.status(400).json({
      error: true,
      status: 400,
      message: error?.message || "Something went wrong",
    });
  }
});

module.exports = {
  inventoryPaginatedList,
};