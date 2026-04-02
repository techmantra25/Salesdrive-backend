const asyncHandler = require("express-async-handler");
const Inventory = require("../../models/inventory.model");
const Price = require("../../models/price.model");
const { format } = require("fast-csv");
const moment = require("moment-timezone");
const Distributor = require("../../models/distributor.model");
const mongoose = require("mongoose");

const allInventoriesPaginatedListReportOld = asyncHandler(async (req, res) => {
  try {
    // Generate filename with Asia/Kolkata timezone
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Current_Stock_Report_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a"
    )}.csv`;

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Build filter object
    const filter = {};
    const {
      stockType,
      showZeroStock,
      distributorIds,
      search,
      startDate,
      endDate,
    } = req.query;

    // Filter by distributor IDs
    if (distributorIds) {
      const ids = distributorIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => !!id);
      if (ids.length > 0) {
        filter.distributorId = { $in: ids };
      }
    }

    // Search functionality
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [{ invitemId: searchRegex }];
    }

    // Date range filter
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Handle zero stock filtering
    const showZeroStockBool =
      showZeroStock === true || showZeroStock === "true";

    if (!showZeroStockBool) {
      if (stockType === "salable") {
        filter.$or = [
          { availableQty: { $gt: 0 } },
          { reservedQty: { $gt: 0 } },
        ];
      } else if (stockType === "unsalable") {
        filter.$or = [{ unsalableQty: { $gt: 0 } }];
      } else if (stockType === "offer") {
        filter.$or = [{ offerQty: { $gt: 0 } }];
      } else {
        filter.$or = [
          { availableQty: { $gt: 0 } },
          { reservedQty: { $gt: 0 } },
          { unsalableQty: { $gt: 0 } },
          { offerQty: { $gt: 0 } },
        ];
      }
    }

    // Debug logs
    const totalDocs = await Inventory.countDocuments({});
    const filteredDocs = await Inventory.countDocuments(filter);
    console.log("Total Inventory docs:", totalDocs);
    console.log("Filtered Inventory docs:", filteredDocs);
    console.log("MongoDB Query:", JSON.stringify(filter, null, 2));

    // Populate fields
    const populateFields = [
      {
        path: "productId",
        select: "",
        populate: [
          { path: "brand", select: "code desc" },
          { path: "subBrand", select: "code desc" },
          { path: "cat_id", select: "code name" },
        ],
      },
      {
        path: "distributorId",
        select: "dbCode name",
      },
    ];

    // CSV headers
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

    // Create CSV stream
    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Function to get price for a product and distributor
    const getProductPrice = async (productId, distributorId) => {
      try {
        // Try to find distributor-specific price first
        let price = await Price.findOne({
          productId: productId,
          distributorId: distributorId,
          status: true,
          $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
        }).sort({ createdAt: -1 });

        // If no distributor-specific price, try regional price
        if (!price && distributorId) {
          const distributor = await Distributor.findById(distributorId).select(
            "regionId"
          );

          if (distributor?.regionId) {
            price = await Price.findOne({
              productId: productId,
              regionId: distributor.regionId,
              price_type: "regional",
              status: true,
              $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
            }).sort({ createdAt: -1 });
          }
        }

        // If still no price, try national price
        if (!price) {
          price = await Price.findOne({
            productId: productId,
            price_type: "national",
            status: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
          }).sort({ createdAt: -1 });
        }

        return {
          dlp_price: price?.dlp_price || "",
          rlp_price: price?.rlp_price || "",
        };
      } catch (error) {
        console.error("Error fetching price:", error);
        return { dlp_price: "", rlp_price: "" };
      }
    };

    // Process data in batches to avoid memory issues
    const batchSize = 100;
    let skip = 0;
    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
      const inventoryBatch = await Inventory.find(filter)
        .populate(populateFields)
        .skip(skip)
        .limit(batchSize)
        .lean(); // Use lean() for better performance

      if (inventoryBatch.length === 0) {
        hasMore = false;
        break;
      }

      // Process each item in the batch
      for (const inv of inventoryBatch) {
        // Get price information
        const priceInfo = await getProductPrice(
          inv.productId?._id,
          inv.distributorId?._id
        );

        console.log("Processing inventory item:", priceInfo);

        // Write to CSV
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
          "Total Qty":
            (inv.availableQty || 0) +
            (inv.reservedQty || 0) +
            (inv.unsalableQty || 0) +
            (inv.offerQty || 0),
        });

        totalProcessed++;
      }

      skip += batchSize;

      // If we got less than batch size, we've reached the end
      if (inventoryBatch.length < batchSize) {
        hasMore = false;
      }
    }

    console.log("Total rows written to CSV:", totalProcessed);

    // End the CSV stream
    csvStream.end();
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).send("Server Error: " + error.message);
  }
});

const allInventoriesPaginatedListReport = asyncHandler(async (req, res) => {
  try {
    console.time("⏱ Total Export Time");

    // ==============================
    // 1️⃣ CSV Response Setup
    // ==============================
    const now = moment().tz("Asia/Kolkata");
    const fileName = `Current_Stock_Report_${now.format(
      "DD-MM-YYYY_hh-mm-ss-a"
    )}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // ==============================
    // 2️⃣ Build Filter
    // ==============================
    const filter = {};
    const {
      stockType,
      showZeroStock,
      distributorIds,
      search,
      startDate,
      endDate,
    } = req.query;

    // Distributor filter
    if (distributorIds) {
      const ids = distributorIds
      .split(",")
      .map(id => id.trim())
      .filter(Boolean)
      .map(id => new mongoose.Types.ObjectId(id));
      if (ids.length > 0) filter.distributorId = { $in: ids };
    }

    // Search
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [{ invitemId: searchRegex }];
    }

    // Date range filter
    if (startDate && endDate) {
      filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Handle zero stock filtering
    const showZeroStockBool =
      showZeroStock === true || showZeroStock === "true";

    if (!showZeroStockBool) {
      switch (stockType) {
        case "salable":
          filter.$or = [
            { availableQty: { $gt: 0 } },
            { reservedQty: { $gt: 0 } },
          ];
          break;
        case "unsalable":
          filter.$or = [{ unsalableQty: { $gt: 0 } }];
          break;
        case "offer":
          filter.$or = [{ offerQty: { $gt: 0 } }];
          break;
        default:
          filter.$or = [
            { availableQty: { $gt: 0 } },
            { reservedQty: { $gt: 0 } },
            { unsalableQty: { $gt: 0 } },
            { offerQty: { $gt: 0 } },
          ];
      }
    }

    console.log("MongoDB Query:", JSON.stringify(filter, null, 2));

    // ==============================
    // 3️⃣ Prefetch Price Data
    // ==============================
    console.time("💰 Load Prices");
    const priceDocs = await Price.find({
      status: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
    })
      .select("productId distributorId regionId price_type dlp_price rlp_price")
      .lean();

    const priceMap = new Map();
    for (const p of priceDocs) {
      const key =
        p.distributorId?.toString() ||
        p.regionId?.toString() ||
        p.price_type;
      priceMap.set(`${p.productId}_${key}`, p);
    }
    console.timeEnd("💰 Load Prices");
    console.time("⏱ CSV Qeury execution");
    // ==============================
    // 4️⃣ Aggregation with Streaming Cursor
    // ==============================
    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "products",
          localField: "productId",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "distributors",
          localField: "distributorId",
          foreignField: "_id",
          as: "distributor",
        },
      },
      { $unwind: { path: "$distributor", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "brands",
          localField: "product.brand",
          foreignField: "_id",
          as: "brand",
        },
      },
      { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "subbrands",
          localField: "product.subBrand",
          foreignField: "_id",
          as: "subBrand",
        },
      },
      { $unwind: { path: "$subBrand", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "categories",
          localField: "product.cat_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          distributorId: "$distributor._id",
          productId: "$product._id",
          "Distributor Code": "$distributor.dbCode",
          "Distributor Name": "$distributor.name",
          "Brand Code": "$brand.code",
          Brand: "$brand.desc",
          "Sub Brand Code": "$subBrand.code",
          "Sub Brand": "$subBrand.desc",
          "Category Code": "$category.code",
          Category: "$category.name",
          "Product Code": "$product.product_code",
          "Product Name": "$product.name",
          availableQty: 1,
          reservedQty: 1,
          unsalableQty: 1,
          offerQty: 1,
        },
      },
    ];

    const agg = Inventory.aggregate(pipeline).cursor({ batchSize: 1000 });
    const cursor = typeof agg.exec === "function" ? agg.exec() : agg;

    // ==============================
    // 5️⃣ CSV Stream Setup
    // ==============================
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

    // ==============================
    // 6️⃣ Stream & Write CSV
    // ==============================
    console.timeEnd("⏱ CSV Qeury execution");
    console.time("📤 Stream & Write CSV");
    let processed = 0;

    for await (const inv of cursor) {
      // Get best price for product + distributor
      const productId = inv.productId?.toString();
      const distributorId = inv.distributorId?.toString();

      const price =
        priceMap.get(`${productId}_${distributorId}`) ||
        priceMap.get(`${productId}_regional`) ||
        priceMap.get(`${productId}_national`) || {};

      csvStream.write({
        "Distributor Code": inv["Distributor Code"] || "",
        "Distributor Name": inv["Distributor Name"] || "",
        "Brand Code": inv["Brand Code"] || "",
        Brand: inv["Brand"] || "",
        "Sub Brand Code": inv["Sub Brand Code"] || "",
        "Sub Brand": inv["Sub Brand"] || "",
        "Category Code": inv["Category Code"] || "",
        Category: inv["Category"] || "",
        "Product Code": inv["Product Code"] || "",
        "Product Name": inv["Product Name"] || "",
        "DLP Price": price.dlp_price || "",
        "RLP Price": price.rlp_price || "",
        "Salable Qty": inv.availableQty || 0,
        "Reserved Qty": inv.reservedQty || 0,
        "Unsalable Qty": inv.unsalableQty || 0,
        "Offer Qty": inv.offerQty || 0,
        "Total Qty":
          (inv.availableQty || 0) +
          (inv.reservedQty || 0) +
          (inv.unsalableQty || 0) +
          (inv.offerQty || 0),
      });

      processed++;
      if (processed % 10000 === 0)
        console.log(`✅ Processed ${processed} records...`);
    }

    csvStream.end();
    console.log(`🎉 Export completed: ${processed} rows`);
    console.timeEnd("⏱ Total Export Time");
  } catch (error) {
    console.error("❌ Server Error:", error);
    res.status(500).send("Server Error: " + error.message);
  }
});


module.exports = {
  allInventoriesPaginatedListReport,
};
