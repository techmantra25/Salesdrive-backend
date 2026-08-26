const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const mongoose = require("mongoose");
const Transaction = require("../../models/transaction.model");
const Invoice = require("../../models/invoice.model");
const Distributor = require("../../models/distributor.model");
const getInTransitQty = require("../../utils/getInTransitQty");
const orderentry = require("../../models/orderEntry.model");
const Price = require("../../models/price.model");

// Maps frontend sort keys -> actual field paths in the aggregation pipeline.
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

// closingStockCount is intentionally NOT in SORTABLE_FIELDS
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
      zeroStockFilter,
      sortField,
      sortOrder,
    } = req.query;

    const distributorId = req.user._id;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

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
    // --------------------------------------------------
    // INVENTORY FILTER
    // --------------------------------------------------

    const matchStage = {
      distributorId: distributorId,
      ...godownMatchFragment,
    };

    if (zeroStockFilter === "false") {
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

    pipeline.push({
      $match: matchStage,
    });

    // --------------------------------------------------
    // PRODUCT
    // --------------------------------------------------

    // ---- Combine across godowns when no specific godown is selected ----
    // Without a godownId filter, the same product can appear as multiple
    // separate Inventory docs (one per godown), which previously rendered
    // as duplicate rows in the UI. When the user picks "All Godowns" (no
    // godownId, only distributorId / godownType in matchStage), we group
    // by productId and SUM the quantity/amount fields so the table shows
    // one combined row per product instead of one row per (product,
    // godown) pair.
    //
    // When a specific godownId IS selected, we skip this — each doc is
    // already scoped to exactly that godown, so per-godown rows are shown
    // as-is (matches previous, expected behavior for a single godown).
    const combineAcrossGodowns = !godownId;

    if (combineAcrossGodowns) {
      pipeline.push({
        $group: {
          _id: "$productId",
          productId: { $first: "$productId" },
          distributorId: { $first: "$distributorId" },
          openingStock: { $first: "$openingStock" },
          availableQty: { $sum: "$availableQty" },
          unsalableQty: { $sum: "$unsalableQty" },
          intransitQty: { $sum: "$intransitQty" },
          undeliveredQty: { $sum: "$undeliveredQty" },
          damagedQty: { $sum: "$damagedQty" },
          reservedQty: { $sum: "$reservedQty" },
          offerQty: { $sum: "$offerQty" },
          totalQty: { $sum: "$totalQty" },
          normsQty: { $sum: "$normsQty" },
          totalStockamtDlp: { $sum: "$totalStockamtDlp" },
          totalStockamtRlp: { $sum: "$totalStockamtRlp" },
          totalUnsalableamtDlp: { $sum: "$totalUnsalableamtDlp" },
          totalUnsalableStockamtRlp: { $sum: "$totalUnsalableStockamtRlp" },
        },
      });
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

    pipeline.push({
      $unwind: "$product",
    });

    // Product filters
    const productMatchStage = {};

    if (productId) {
      productMatchStage["product._id"] =
        new mongoose.Types.ObjectId(productId);
    }

    if (searchTerm) {
      const tokens = searchTerm.trim().split(/\s+/).filter(Boolean);

      productMatchStage["$and"] = tokens.map((token) => ({
        $or: [
          {
            "product.product_code": {
              $regex: token,
              $options: "i",
            },
          },
          {
            "product.name": {
              $regex: token,
              $options: "i",
            },
          },
        ],
      }));
    }

    if (brandId) {
      productMatchStage["product.brand"] =
        new mongoose.Types.ObjectId(brandId);
    }

    if (categoryId) {
      productMatchStage["product.cat_id"] =
        new mongoose.Types.ObjectId(categoryId);
    }

    if (collectionId) {
      productMatchStage["product.collection_id"] =
        new mongoose.Types.ObjectId(collectionId);
    }

    if (Object.keys(productMatchStage).length > 0) {
      pipeline.push({
        $match: productMatchStage,
      });
    }

    // --------------------------------------------------
    // DISTRIBUTOR
    // --------------------------------------------------

    pipeline.push({
      $lookup: {
        from: "distributors",
        localField: "distributorId",
        foreignField: "_id",
        as: "distributor",
      },
    });

    pipeline.push({
      $unwind: "$distributor",
    });

    // Get distributor region
    pipeline.push({
      $addFields: {
        distributorRegionId: "$distributor.regionId",
      },
    });

    // --------------------------------------------------
    // PRICE
    // Regional price first
    // National price if regional does not exist
    // --------------------------------------------------

    pipeline.push({
      $lookup: {
        from: "prices",
        let: {
          productId: "$productId",
          regionId: "$distributorRegionId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ["$productId", "$$productId"],
                  },
                  {
                    $eq: ["$status", true],
                  },
                  {
                    $or: [
                      {
                        $and: [
                          {
                            $eq: ["$price_type", "regional"],
                          },
                          {
                            $eq: ["$regionId", "$$regionId"],
                          },
                        ],
                      },
                      {
                        $eq: ["$price_type", "national"],
                      },
                    ],
                  },
                ],
              },
            },
          },

          // Regional gets priority over national
          {
            $addFields: {
              pricePriority: {
                $cond: [
                  {
                    $eq: ["$price_type", "regional"],
                  },
                  1,
                  2,
                ],
              },
            },
          },

          // Latest price
          {
            $sort: {
              pricePriority: 1,
              effective_date: -1,
              createdAt: -1,
            },
          },

          {
            $limit: 1,
          },
        ],
        as: "selectedPrice",
      },
    });

    // Convert selectedPrice array into object
    pipeline.push({
      $unwind: {
        path: "$selectedPrice",
        preserveNullAndEmptyArrays: true,
      },
    });

    // --------------------------------------------------
    // CALCULATE BASE POINT + DLP/RLP
    // --------------------------------------------------

    pipeline.push({
      $addFields: {
        // Existing base point calculation
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
                {
                  $convert: {
                    input: "$availableQty",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
                {
                  $convert: {
                    input: "$reservedQty",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              ],
            },
          ],
        },

        // AVAILABLE QTY × DLP PRICE
        totalStockamtDlp: {
          $multiply: [
            {
              $convert: {
                input: "$availableQty",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            {
              $convert: {
                input: "$selectedPrice.dlp_price",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          ],
        },

        // AVAILABLE QTY × RLP PRICE
        totalStockamtRlp: {
          $multiply: [
            {
              $convert: {
                input: "$availableQty",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            {
              $convert: {
                input: "$selectedPrice.rlp_price",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          ],
        },
      },
    });

    // --------------------------------------------------
    // SORT
    // --------------------------------------------------

    const sortDirection = sortOrder === "desc" ? -1 : 1;

    const sortKey =
      SORTABLE_FIELDS[sortField] || "product.name";

    pipeline.push({
      $sort: {
        [sortKey]: sortDirection,
        _id: 1,
      },
    });

    // --------------------------------------------------
    // PAGINATION
    // --------------------------------------------------

    const paginatedPipeline = [...pipeline];

    // Total count — scoped to distributor + the selected godown filter
    // (godownId/godownType) but NOT the other filters like brand/category/
    // search/stockType. This gives "how many items exist in this godown"
    // as a baseline, separate from "how many match my current filters"
    // (that's filteredCountPipeline below).
    paginatedPipeline.push({
      $skip: (pageNum - 1) * limitNum,
    });

    paginatedPipeline.push({
      $limit: limitNum,
    });

    // --------------------------------------------------
    // TOTAL COUNT
    // --------------------------------------------------

    const totalCountPipeline = [
      {
        $match: {
          distributorId: distributorId,
          ...godownMatchFragment,
        },
      },
      // Mirror the same combine-across-godowns logic used in the main
      // pipeline: when no specific godownId is selected, count distinct
      // products (post-group row count), not raw per-godown docs — so
      // this number matches what the table actually displays.
      ...(combineAcrossGodowns ? [{ $group: { _id: "$productId" } }] : []),
      {
        $count: "totalItems",
      },
    ];

    // --------------------------------------------------
    // FILTERED COUNT
    // --------------------------------------------------

    const filteredCountPipeline = [
      ...pipeline,
      {
        $count: "totalFilteredItems",
      },
    ];

    // --------------------------------------------------
    // DISTRIBUTOR INFO
    // --------------------------------------------------

    const distributor = await Distributor.findById(
      distributorId
    ).select("RBPSchemeMapped regionId");

    // --------------------------------------------------
    // EXECUTE
    // --------------------------------------------------

    let [
      inventories,
      totalCountResult,
      filteredCountResult,
    ] = await Promise.all([
      Inventory.aggregate(paginatedPipeline),
      Inventory.aggregate(totalCountPipeline),
      Inventory.aggregate(filteredCountPipeline),
    ]);

    const totalItems =
      totalCountResult.length > 0
        ? totalCountResult[0].totalItems
        : 0;

    const totalFilteredItems =
      filteredCountResult.length > 0
        ? filteredCountResult[0].totalFilteredItems
        : 0;

    const totalPages = Math.ceil(
      totalFilteredItems / limitNum
    );

    // --------------------------------------------------
    // CLOSING STOCK
    // --------------------------------------------------

    if (closingStockDate && stockType) {
      let endDate = new Date(closingStockDate);

      endDate.setHours(23, 59, 59, 999);

      inventories = await Promise.all(
        inventories.map(async (invItem) => {
          const transactions = await Transaction.find({
            $and: [
              {
                distributorId: distributorId,
              },
              {
                productId: invItem.productId,
              },
              {
                createdAt: {
                  $lt: endDate,
                },
              },
              {
                stockType: stockType,
              },
            ],
          }).sort({
            createdAt: -1,
          });

          if (transactions.length > 0) {
            const lastTransaction = transactions[0];

            return {
              ...invItem,
              closingStockCount:
                lastTransaction?.balanceCount,
            };
          }

          return {
            ...invItem,
            closingStockCount: null,
          };
        })
      );
    }

    // --------------------------------------------------
    // PENDING ORDER QTY
    // --------------------------------------------------

    const PENDING_ORDER_STATUSES = ["Pending"];

    const pageProductIds = inventories.map(
      (inv) => inv.productId
    );

    if (pageProductIds.length > 0) {
    const pendingOrderQtyPipeline = [
  {
    $match: {
      distributorId: distributorId,
      status: { $in: PENDING_ORDER_STATUSES },
      // godownId lives on the OrderEntry header, not on each lineItem —
      // filter here, before unwinding, not on "lineItems.godownId" (that
      // field doesn't exist in the schema; see sample OrderEntry docs).
      ...(godownId
        ? { godownId: new mongoose.Types.ObjectId(godownId) }
        : {}),
    },
  },
  { $unwind: "$lineItems" },
  {
    $match: {
      "lineItems.product": { $in: pageProductIds },
    },
  },
  {
    $group: {
      _id: "$lineItems.product",
      pendingOrderQty: { $sum: "$lineItems.oderQty" },
    },
  },
];

      const pendingOrderQtyResult =
        await orderentry.aggregate(
          pendingOrderQtyPipeline
        );

      const pendingQtyMap = {};

      pendingOrderQtyResult.forEach((item) => {
        pendingQtyMap[item._id.toString()] =
          item.pendingOrderQty;
      });

      inventories = inventories.map((invItem) => ({
        ...invItem,
        pendingOrderQty:
          pendingQtyMap[
            invItem.productId.toString()
          ] || 0,
      }));
    } else {
      inventories = inventories.map((invItem) => ({
        ...invItem,
        pendingOrderQty: 0,
      }));
    }

    // --------------------------------------------------
    // RESULT
    // --------------------------------------------------

    const resultInventories = inventories;

    // Calculate currentStockTotalPoints if conditions are met
    // --------------------------------------------------
    // CURRENT STOCK TOTAL POINTS
    // --------------------------------------------------

    let currentStockTotalPoints = null;

    if (
      distributor?.RBPSchemeMapped === "yes" &&
      stockType === "salable"
    ) {
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

      if (
        Object.keys(productMatchStage).length > 0
      ) {
        pointsCalculationPipeline.push({
          $match: productMatchStage,
        });
      }

      const allInventoriesForPoints =
        await Inventory.aggregate(
          pointsCalculationPipeline
        );

      currentStockTotalPoints =
        allInventoriesForPoints.reduce(
          (totalPoints, invItem) => {
            const basePoint =
              parseFloat(
                invItem.product?.base_point
              ) || 0;

            const availableQty =
              Number(invItem.availableQty) || 0;

            const reservedQty =
              Number(invItem.reservedQty) || 0;

            const totalQty =
              availableQty + reservedQty;

            const productPoints =
              basePoint * totalQty;

            return totalPoints + productPoints;
          },
          0
        );
    }

    // --------------------------------------------------
    // PAGINATION RESPONSE
    // --------------------------------------------------

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
      pagination.currentStockTotalPoints =
        currentStockTotalPoints;
    }

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

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
      message:
        error?.message || "Something went wrong",
    });
  }
});

module.exports = {
  inventoryPaginatedList,
};