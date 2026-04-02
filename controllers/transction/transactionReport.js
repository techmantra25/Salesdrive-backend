const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const Transaction = require("../../models/transaction.model");
const Distributor = require("../../models/distributor.model");
const mongoose = require("mongoose");
const Product = require("../../models/product.model");

const transactionReport = asyncHandler(async (req, res) => {
  try {
    const {
      searchTerm,
      type,
      stockType,
      toDate,
      fromDate,
      transactionFor,
      distributorId,
      productIds,
    } = req.query;

    // Build the match stage for filtering
    const matchStage = {
      distributorId: distributorId,
    };

    //looking for the distributor
    const distributor = await Distributor.findById(distributorId).select('RBPSchemeMapped');
    const rbpSchemeMapped = distributor?.RBPSchemeMapped;


    // Date filtering

    if (fromDate || toDate) {
      matchStage.createdAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        matchStage.createdAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = endOfDay;
      }
    }

    // Filter by searchTerm if provided
    if (searchTerm) {
      matchStage.$or = [
        { transactionId: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ];
    }
    // Filter by transaction type if provided
    if (type) {
      matchStage.type = type;
    }

    // Stock type filter
    if (stockType) {
      matchStage.stockType = stockType;
    }

    // Filter by transaction for if provided
    if (transactionFor) {
      matchStage.transactionType = transactionFor;
    }

    if (productIds) {
      const ids = productIds.split(",").map(
        (id) => new mongoose.Types.ObjectId(id)
      );

      matchStage.productId = { $in: ids };
    }

    // Filter by searchTerm if provided
    // Filter by searchTerm if provided (INCLUDING PRODUCT SEARCH)
    if (searchTerm) {

      // Find matching products first
      const matchingProducts = await Product.find({
        $or: [
          { product_code: { $regex: searchTerm, $options: "i" } },
          { name: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      const productIdsFromSearch = matchingProducts.map(p => p._id);

      matchStage.$or = [
        { transactionId: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ];

      // include product matches also
      if (productIdsFromSearch.length > 0) {
        matchStage.$or.push({
          productId: { $in: productIdsFromSearch },
        });
      }
    }
    // Prepare CSV headers
    const headers = [
      "Transaction ID",
      "Product Code",
      "Product Name",
      "Date & Time",
      "Transaction Type",
      "Transaction For",
      "Stock Type",

      ...(rbpSchemeMapped === "yes" ? ["Base Point"] : []),
      "Quantity",
      ...(rbpSchemeMapped === "yes" ? ["Total Point"] : []),
      "Description",
    ];

    const fileName = `transaction-report-for-${transactionFor}-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Fetch filtered transactions with population
    const transactions = await Transaction.find(matchStage)
      .populate({
        path: "productId",
        model: "Product",
        select: "product_code name base_point",
      })
      .populate({
        path: "invItemId",
        model: "Inventory",
      })
      .populate({
        path: "distributorId",
        model: "Distributor",
        select: "name dbCode",
      })
      .sort({ createdAt: -1 });

    // Write transactions to CSV
    transactions.forEach((transaction) => {
      const basePoint = parseFloat(transaction.productId?.base_point || 0);
      const quantity = transaction.qty || 0;
      const totalPoints = basePoint * quantity;

      csvStream.write({
        "Transaction ID": transaction.transactionId || "",
        "Product Code": transaction.productId?.product_code || "",
        "Product Name": transaction.productId?.name || "",
        "Date & Time": transaction.date
          ? moment(transaction.date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm:ss A")
          : "",
        "Transaction Type": transaction.type || "",
        "Transaction For": transaction.transactionType || "",
        "Stock Type": transaction.stockType || "",
        ...(rbpSchemeMapped === "yes" ? { "Base Point": transaction.productId?.base_point } : {}),
        Quantity: quantity,
        ...(rbpSchemeMapped === "yes" ? { "Total Point": transaction.type === "In" ? totalPoints : -totalPoints } : {}),
        Description: transaction.description || "",
      });
    });

    csvStream.end();
  } catch (error) {
    console.error("Transaction Report Error:", error.message);
    res.status(500).json({
      status: 500,
      message: "Failed to generate transaction report",
      error: error.message,
    });
  }
});

module.exports = { transactionReport };
