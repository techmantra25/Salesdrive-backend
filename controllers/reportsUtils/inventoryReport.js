const mongoose = require("mongoose");
const ReportRequest = require("../../models/reportRequest.model");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const Inventory = require("../../models/inventory.model");
const Transaction = require("../../models/transaction.model");
const moment = require("moment-timezone");
const { SERVER_URL } = require("../../config/server.config");
const { default: axios } = require("axios");
const FormData = require("form-data");

const inventoryReportUtil = async (query, body, user, reqId) => {
  try {
    const response = await inventoryReport(query, body, user);

    await ReportRequest.findByIdAndUpdate(reqId, {
      $set: {
        status: "Completed",
        data: response,
        error: null,
      },
    });
  } catch (error) {
    await ReportRequest.findByIdAndUpdate(reqId, {
      $set: {
        status: "Failed",
        error: error?.message,
      },
    });
    console.error(error);
  }
};

const inventoryReport = async (query, body, user) => {
  try {
    const {
      productId,
      searchTerm,
      brandId,
      categoryId,
      collectionId,
      godownType,
      closingStockDate,
      stockType,
    } = body;

    if (!stockType) throw new Error("Stock type is required");

    const distributorId = user?._id;

    // Build the aggregation pipeline
    const pipeline = [];

    // Match filters for inventory
    const matchStage = {
      distributorId: distributorId,
    };

    if (godownType) {
      matchStage.godownType = godownType;
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

    // Total count for all items (no filters applied)
    const totalCountPipeline = [
      {
        $count: "totalItems",
      },
    ];

    // Execute all pipelines concurrently
    let [inventories, totalCountResult] = await Promise.all([
      Inventory.aggregate(paginatedPipeline),
      Inventory.aggregate(totalCountPipeline),
    ]);

    if (closingStockDate && stockType) {
      let endDate = new Date(closingStockDate);
      endDate.setHours(23, 59, 59, 999);

      inventories = await Promise.all(
        inventories.map(async (invItem) => {
          const transactions = await Transaction.find({
            $and: [
              { distributorId: distributorId },
              { productId: invItem.productId },
              { stockType: stockType },
              { createdAt: { $lt: endDate } },
            ],
          }).sort({ createdAt: -1 });

          if (transactions.length > 0) {
            const lastTransaction = transactions[0];
            return {
              ...invItem,
              closingStockCount: lastTransaction?.balanceCount,
              closingStockDate: moment(closingStockDate)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY"),
            };
          } else {
            return {
              ...invItem,
              closingStockCount: 0,
              closingStockDate: moment(closingStockDate)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY"),
            };
          }
        })
      );
    }

    // Once you have `inventories` ready, map it to CSV format:
    let csvData = inventories.map((inventoryItem) => ({
      "FG Code": inventoryItem.product.sku_group_id ?? "",
      "Product Code": inventoryItem.product.product_code ?? "",
      Size: inventoryItem.product.size ?? "",
      Product: inventoryItem.product.name ?? "",
      Godown: inventoryItem.godownType ?? "",
      // "In-Transit Qty in Pcs": inventoryItem.intransitQty ?? 0,
      // "Un-delivered Qty in Pcs": inventoryItem.undeliveredQty ?? 0,
      // "Damage Qty in Pcs": inventoryItem.damagedQty ?? 0,
      "Qty in Pcs":
        stockType === "salable"
          ? inventoryItem.availableQty
          : stockType === "unsalable"
          ? inventoryItem.unsalableQty
          : inventoryItem.offerQty,
      "Total Stock Amount in DLP":
        stockType === "salable"
          ? inventoryItem.totalStockamtDlp
          : stockType === "unsalable"
          ? inventoryItem.totalUnsalableamtDlp
          : "",
      "Total Stock Amount in RLP":
        stockType === "salable"
          ? inventoryItem.totalStockamtRlp
          : stockType === "unsalable"
          ? inventoryItem.totalUnsalableStockamtRlp
          : "",
      "Noms Qty": inventoryItem.normsQty ?? 0,
      "Closing Stock Qty in Pcs": inventoryItem.closingStockCount ?? "",
      "Closing Stock Date": inventoryItem.closingStockDate ?? "",
    }));

    // Define the fields to be exported
    let fields = [
      { label: "FG Code", value: "FG Code" },
      { label: "Product Code", value: "Product Code" },
      { label: "Size", value: "Size" },
      { label: "Product", value: "Product" },
      { label: "Godown", value: "Godown" },
      // { label: "In-Transit Qty in Pcs", value: "In-Transit Qty in Pcs" },
      // { label: "Un-delivered Qty in Pcs", value: "Un-delivered Qty in Pcs" },
      // { label: "Damage Qty in Pcs", value: "Damage Qty in Pcs" },
      { label: `${stockType} Qty in Pcs`, value: "Qty in Pcs" },
      {
        label: "Total Stock Amount in DLP",
        value: "Total Stock Amount in DLP",
      },
      {
        label: "Total Stock Amount in RLP",
        value: "Total Stock Amount in RLP",
      },
      { label: "Noms Qty", value: "Noms Qty" },
    ];

    if (closingStockDate) {
      fields.push(
        {
          label: "Closing Stock Qty in Pcs",
          value: "Closing Stock Qty in Pcs",
        },
        {
          label: "Closing Stock Date",
          value: "Closing Stock Date",
        }
      );
    }

    // Create CSV
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    // Save CSV file to the server temporarily
    const filePath = path.join(__dirname, "inventory.csv");
    fs.writeFileSync(filePath, csv);

    // Upload CSV file to Cloudinary or any cloud service
    // const result = await cloudinary.uploader.upload(filePath, {
    //   resource_type: "raw",
    //   public_id: `inventory-${Date.now()}`,
    //   folder: "lux-dms",
    // });

    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `inventory-${Date.now()}`);
    const CLOUDINARY_UPLOAD_URL = `${SERVER_URL}/api/v1/cloudinary/upload`;

    const result = await axios.post(CLOUDINARY_UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Remove the temporary file
    fs.unlinkSync(filePath);

    return {
      csvLink: result.data?.secure_url,
      count: inventories.length,
      query: query,
      body: body,
    };
  } catch (error) {
    throw new Error(error?.message || "Something went wrong");
  }
};

module.exports = {
  inventoryReportUtil,
};
