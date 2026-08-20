const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const mongoose = require("mongoose");
const Transaction = require("../../models/transaction.model");
const Invoice = require("../../models/invoice.model");
const Distributor = require("../../models/distributor.model");
const getInTransitQty = require("../../utils/getInTransitQty");
const orderentry = require("../../models/orderEntry.model");

// Maps frontend sort keys -> actual field paths in the aggregation pipeline.
// Paths under "product." only exist after the $unwind stage.
// "basePointTotal" is a computed field added via $addFields (see below).
const SORTABLE_FIELDS = {
  product_code: "product.product_code",
  product_type: "product.product_type",
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
      godownId,
      godownType,
      closingStockDate,
      stockType,
      zeroStockFilter, // "true" (only zero) | "false" (hide zero) | undefined/"all" (no filter)
      sortField,
      sortOrder,
    } = req.query;

    const distributorId = req.user._id;

    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Build the aggregation pipeline
    const pipeline = [];

    // ---- Shared godown filter fragment ----
    // A specific godownId always takes precedence over godownType, since
    // godownType is a denormalized field on each inventory doc (copied from
    // the godown it belongs to) and a specific godown already disambiguates
    // type. This same fragment is reused in totalCountPipeline and
    // pointsCalculationPipeline so all counts/totals stay consistent with
    // whichever godown filter the user has selected.
    const godownMatchFragment = godownId
      ? { godownId: new mongoose.Types.ObjectId(godownId) }
      : godownType
      ? { godownType: godownType }
      : {};

    // Match filters for inventory
    const matchStage = {
      distributorId: distributorId,
      ...godownMatchFragment,
    };

    if (zeroStockFilter === "false") {
      // Hide zero-quantity items — only rows with positive qty for the
      // selected stockType.
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
    } else if (zeroStockFilter === "true") {
      // Show ONLY zero-quantity items for the selected stockType.
      if (stockType === "salable") {
        matchStage.$and = [
          {
            $or: [
              { availableQty: { $lte: 0 } },
              { availableQty: { $exists: false } },
            ],
          },
          {
            $or: [
              { reservedQty: { $lte: 0 } },
              { reservedQty: { $exists: false } },
            ],
          },
        ];
      } else if (stockType === "unsalable") {
        matchStage.$or = [
          { unsalableQty: { $lte: 0 } },
          { unsalableQty: { $exists: false } },
        ];
      } else if (stockType === "reserve") {
        matchStage.$or = [
          { reservedQty: { $lte: 0 } },
          { reservedQty: { $exists: false } },
        ];
      }
    }
    // zeroStockFilter undefined or "all": no quantity filter applied —
    // every row for the matched stockType is returned, zero or not.

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

    // Total count — scoped to distributor + the selected godown filter
    // (godownId/godownType) but NOT the other filters like brand/category/
    // search/stockType. This gives "how many items exist in this godown"
    // as a baseline, separate from "how many match my current filters"
    // (that's filteredCountPipeline below).
    const totalCountPipeline = [
      {
        $match: {
          distributorId: distributorId,
          ...godownMatchFragment,
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
    // ---- Pending order qty enrichment (page-local, like closingStockCount) ----
    // "Pending" orders (status: 'Pending', billIds: []) represent qty already
    // requested but not yet billed — still counts as committed against stock.
    // 'Completed_Billed' orders are excluded: that stock has already left
    // inventory via the bill, so it's no longer "pending".
    const PENDING_ORDER_STATUSES = ["Pending"]; // add more statuses here if needed, e.g. "Approved"

    const pageProductIds = inventories.map((inv) => inv.productId);

    if (pageProductIds.length > 0) {
      const pendingOrderQtyPipeline = [
        {
          $match: {
            distributorId: distributorId,
            status: { $in: PENDING_ORDER_STATUSES },
          },
        },
        { $unwind: "$lineItems" },
        {
          $match: {
            "lineItems.product": { $in: pageProductIds },
            // TODO-CONFIRM: this assumes orderEntry.lineItems has a
            // godownId field. If it does NOT exist in the schema, this
            // condition silently matches nothing whenever a godown is
            // selected (pendingOrderQty would incorrectly show 0 for every
            // row instead of falling back to distributor-wide). Verify
            // against orderEntry.model.js before relying on this in
            // production — remove this block entirely if the field
            // doesn't exist, and treat pendingOrderQty as inherently
            // distributor-wide (not godown-scoped) instead.
            ...(godownId
              ? { "lineItems.godownId": new mongoose.Types.ObjectId(godownId) }
              : {}),
          },
        },
        {
          $group: {
            _id: "$lineItems.product",
            pendingOrderQty: { $sum: "$lineItems.oderQty" },
          },
        },
      ];

      const pendingOrderQtyResult = await orderentry.aggregate(
        pendingOrderQtyPipeline
      );

      // Build a quick lookup map: productId (string) -> pendingOrderQty
      const pendingQtyMap = {};
      pendingOrderQtyResult.forEach((item) => {
        pendingQtyMap[item._id.toString()] = item.pendingOrderQty;
      });

      inventories = inventories.map((invItem) => ({
        ...invItem,
        pendingOrderQty: pendingQtyMap[invItem.productId.toString()] || 0,
      }));
    } else {
      inventories = inventories.map((invItem) => ({
        ...invItem,
        pendingOrderQty: 0,
      }));
    }
    // ---- end pending order qty enrichment ----

    const resultInventories = inventories;

    // Calculate currentStockTotalPoints if conditions are met
    let currentStockTotalPoints = null;

    if (distributor?.RBPSchemeMapped === "yes" && stockType === "salable") {
      const pointsCalculationPipeline = [
        {
          $match: {
            distributorId: distributorId,
            ...godownMatchFragment,
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