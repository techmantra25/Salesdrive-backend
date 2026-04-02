const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const mongoose = require("mongoose");
const Transaction = require("../../models/transaction.model");
const Invoice = require("../../models/invoice.model");
const Distributor = require("../../models/distributor.model");
const getInTransitQty = require("../../utils/getInTransitQty");

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

    // if (!showZeroStockBool) {
    //   if (stockType === "salable") {
    //     matchStage.availableQty = { $gt: 0 };
    //   } else if (stockType === "unsalable") {
    //     matchStage.unsalableQty = { $gt: 0 };
    //   } else if (stockType === "offer") {
    //     matchStage.offerQty = { $gt: 0 };
    //   }
    // }
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
      // else if (stockType === "offer") {
      //   matchStage.offerQty = { $gt: 0 };
      // }
    }

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Lookup (join) with the Product model to apply product-specific filters
    pipeline.push({
      $lookup: {
        from: "products", // The "products" collection
        localField: "productId", // The field in Inventory
        foreignField: "_id", // The field in Product
        as: "product", // Alias for the lookup result
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
      productMatchStage["$or"] = [
        {
          "product.product_code": {
            $regex: searchTerm,
            $options: "i",
          },
        },
        {
          "product.name": {
            $regex: searchTerm,
            $options: "i",
          },
        },
      ];
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
        from: "distributors", // The "distributors" collection
        localField: "distributorId", // The field in Inventory
        foreignField: "_id", // The field in Distributor
        as: "distributor", // Alias for the lookup result
      },
    });

    // Sort the results by _id (descending)
    pipeline.push({ $sort: { _id: -1 } });

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

    // get In-Transit invoices for this distributor (to calculate the in transit for each product)
    const inTransitInvoices = await Invoice.find({
      distributorId: distributorId,
      status: "In-Transit",
    }).populate("lineItems.product");

    let resultInventories = [...inventories];

    resultInventories = resultInventories.map((invItem) => {
      const intransitQty = getInTransitQty(
        inTransitInvoices,
        invItem?.productId
      );

      return {
        ...invItem,
        intransitQty: intransitQty,
      };
    });

    // Calculate currentStockTotalPoints if conditions are met
    let currentStockTotalPoints = null;

    // console.log("Distributor RBP Scheme Mapped:", distributor);
    // console.log("Stock Type:", stockType);
    if (distributor?.RBPSchemeMapped === "yes" && stockType === "salable") {
      // console.log("Conditions met for points calculation");

      // Create a separate pipeline specifically for salable stock points calculation
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

      // Apply the same product filters if they exist
      if (Object.keys(productMatchStage).length > 0) {
        pointsCalculationPipeline.push({ $match: productMatchStage });
      }

      // console.log(
      //   "Points calculation pipeline:",
      //   JSON.stringify(pointsCalculationPipeline, null, 2)
      // );

      // Get all inventories (not paginated) for points calculation
      const allInventoriesForPoints = await Inventory.aggregate(
        pointsCalculationPipeline
      );

      // console.log(
      //   "All Inventories for Points Calculation count:",
      //   allInventoriesForPoints.length
      // );
      // console.log("Sample inventory item:", allInventoriesForPoints[0]);

      currentStockTotalPoints = allInventoriesForPoints.reduce(
        (totalPoints, invItem) => {
          const basePoint = parseFloat(invItem.product?.base_point) || 0;
          const availableQty = Number(invItem.availableQty) || 0;
          const reservedQty = Number(invItem.reservedQty) || 0;
          const totalQty = availableQty + reservedQty;
          const productPoints = basePoint * totalQty;

          // console.log(
          //   `Product: ${invItem.product?.name}, Base Point: ${basePoint}, Available: ${availableQty}, Reserved: ${reservedQty}, Total Qty: ${totalQty}, Product Points: ${productPoints}`
          // );

          return totalPoints + productPoints;
        },
        0
      );
    }

    // console.log("Current Stock Total Points:", currentStockTotalPoints);

    // Build pagination object
    const pagination = {
      currentPage: pageNum,
      limit: limitNum,
      totalPages,
      totalCount: totalItems,
      filteredCount: totalFilteredItems,
    };

    // Add currentStockTotalPoints only if distributor is RBP mapped
    if (
      distributor?.RBPSchemeMapped === "yes" &&
      currentStockTotalPoints !== null
    ) {
      pagination.currentStockTotalPoints = currentStockTotalPoints;
    }

    // Respond with paginated data
    return res.status(200).json({
      status: 200,
      message: "Inventories fetched successfully",
      data: resultInventories,
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
