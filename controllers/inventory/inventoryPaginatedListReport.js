const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Price = require("../../models/price.model");
const Distributor = require("../../models/distributor.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");

const inventoryPaginatedListReport = asyncHandler(async (req, res) => {
  try {
    const { stockType, showZeroStock, distributorId } = req.query;

    const query = {};
    if (distributorId) {
      query.distributorId = distributorId;
    }

    const showZeroStockBool =
      showZeroStock === true ||
      showZeroStock === "true" ||
      showZeroStock === 1 ||
      showZeroStock === "1";

    if (!showZeroStockBool) {
      if (stockType === "salable") {
        query.$or = [{ availableQty: { $gt: 0 } }, { reservedQty: { $gt: 0 } }];
      } else if (stockType === "unsalable") {
        query.$or = [{ unsalableQty: { $gt: 0 } }];
      } else if (stockType === "offer") {
        query.$or = [{ offerQty: { $gt: 0 } }];
      } else {
        query.$or = [
          { availableQty: { $gt: 0 } },
          { reservedQty: { $gt: 0 } },
          { unsalableQty: { $gt: 0 } },
          { offerQty: { $gt: 0 } },
        ];
      }
    }

    const now = moment().tz("Asia/Kolkata");
    const fileName = `Current_Stock_Report_${now.format("DD-MM-YYYY_hh-mm-ss-a")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const headers = [
      "Distributor Code",
      "Distributor Name",
      "Brand Code",
      "Brand",
      "Sub Brand Code",
      "Sub Brand",
      "Category Code",
      "Category",
      "Product Code",
      "Product Name",
      "DLP Price",
      "RLP Price",
      "Salable Qty",
      "Reserved Qty",
      "Unsalable Qty",
      "Offer Qty",
      "Total Qty",
    ];

    const csvStream = format({ headers });
    csvStream.pipe(res);

    const populateFields = [
      {
        path: "productId",
        select: "product_code name brand subBrand cat_id",
        populate: [
          { path: "brand", select: "code desc" },
          { path: "subBrand", select: "code desc" },
          { path: "cat_id", select: "code name" },
        ],
      },
      {
        path: "distributorId",
        select: "dbCode name regionId",
      },
    ];

    const allInventory = await Inventory.find(query)
      .select("productId distributorId")
      .lean();

    const productIds = [
      ...new Set(
        allInventory.map((inv) => inv.productId?.toString()).filter(Boolean),
      ),
    ];
    const distributorIds = [
      ...new Set(
        allInventory
          .map((inv) => inv.distributorId?.toString())
          .filter(Boolean),
      ),
    ];

    console.log(
      `Fetching prices for ${productIds.length} products and ${distributorIds.length} distributors`,
    );

    const priceQuery = {
      productId: { $in: productIds },
      status: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
    };

    const allPrices = await Price.find(priceQuery)
      .select(
        "productId distributorId regionId price_type dlp_price rlp_price createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();

    const distributorsData = await Distributor.find({
      _id: { $in: distributorIds },
    })
      .select("_id regionId")
      .lean();

    const distributorRegionMap = new Map();
    distributorsData.forEach((dist) => {
      distributorRegionMap.set(dist._id.toString(), dist.regionId?.toString());
    });

    const distributorPriceMap = new Map(); 
    const regionalPriceMap = new Map(); 
    const nationalPriceMap = new Map();

    allPrices.forEach((price) => {
      const productIdStr = price.productId.toString();

      if (price.distributorId) {
        // Distributor-specific price
        const key = `${productIdStr}-${price.distributorId.toString()}`;
        if (!distributorPriceMap.has(key)) {
          distributorPriceMap.set(key, {
            dlp_price: price.dlp_price || "",
            rlp_price: price.rlp_price || "",
          });
        }
      } else if (price.price_type === "regional" && price.regionId) {
        // Regional price
        const key = `${productIdStr}-${price.regionId.toString()}`;
        if (!regionalPriceMap.has(key)) {
          regionalPriceMap.set(key, {
            dlp_price: price.dlp_price || "",
            rlp_price: price.rlp_price || "",
          });
        }
      } else if (price.price_type === "national") {
        // National price
        if (!nationalPriceMap.has(productIdStr)) {
          nationalPriceMap.set(productIdStr, {
            dlp_price: price.dlp_price || "",
            rlp_price: price.rlp_price || "",
          });
        }
      }
    });

    console.log(
      `Price maps created: Distributor=${distributorPriceMap.size}, Regional=${regionalPriceMap.size}, National=${nationalPriceMap.size}`,
    );

    const getProductPrice = (productId, distributorId) => {
      const productIdStr = productId?.toString();
      const distributorIdStr = distributorId?.toString();

      if (!productIdStr) {
        return { dlp_price: "", rlp_price: "" };
      }

      if (distributorIdStr) {
        const distKey = `${productIdStr}-${distributorIdStr}`;
        const distPrice = distributorPriceMap.get(distKey);
        if (distPrice) return distPrice;

        const regionId = distributorRegionMap.get(distributorIdStr);
        if (regionId) {
          const regionKey = `${productIdStr}-${regionId}`;
          const regionPrice = regionalPriceMap.get(regionKey);
          if (regionPrice) return regionPrice;
        }
      }

      const nationalPrice = nationalPriceMap.get(productIdStr);
      if (nationalPrice) return nationalPrice;

      return { dlp_price: "", rlp_price: "" };
    };

    const batchSize = 500;
    let skip = 0;
    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
      const inventoryBatch = await Inventory.find(query)
        .populate(populateFields)
        .skip(skip)
        .limit(batchSize)
        .lean();

      if (inventoryBatch.length === 0) {
        hasMore = false;
        break;
      }

      for (const inv of inventoryBatch) {
        const priceInfo = getProductPrice(
          inv.productId?._id,
          inv.distributorId?._id,
        );

        const totalQty =
          (inv.availableQty || 0) +
          (inv.reservedQty || 0) +
          (inv.unsalableQty || 0) +
          (inv.offerQty || 0);

        csvStream.write({
          "Distributor Code": inv.distributorId?.dbCode || "",
          "Distributor Name": inv.distributorId?.name || "",
          "Brand Code": inv.productId?.brand?.code || "",
          Brand: inv.productId?.brand?.desc || "",
          "Sub Brand Code": inv.productId?.subBrand?.code || "",
          "Sub Brand": inv.productId?.subBrand?.desc || "",
          "Category Code": inv.productId?.cat_id?.code || "",
          Category: inv.productId?.cat_id?.name || "",
          "Product Code": inv.productId?.product_code || "",
          "Product Name": inv.productId?.name || "",
          "DLP Price": priceInfo.dlp_price,
          "RLP Price": priceInfo.rlp_price,
          "Salable Qty": inv.availableQty || 0,
          "Reserved Qty": inv.reservedQty || 0,
          "Unsalable Qty": inv.unsalableQty || 0,
          "Offer Qty": inv.offerQty || 0,
          "Total Qty": totalQty,
        });

        totalProcessed++;
      }

      skip += batchSize;

      if (inventoryBatch.length < batchSize) {
        hasMore = false;
      }
    }

    console.log("Total rows written to CSV:", totalProcessed);
    csvStream.end();
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).send("Server Error: " + error.message);
  }
});

module.exports = {
  inventoryPaginatedListReport,
};
