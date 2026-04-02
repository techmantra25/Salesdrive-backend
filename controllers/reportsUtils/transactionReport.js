const Transaction = require("../../models/transaction.model");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const mongoose = require("mongoose");
const ReportRequest = require("../../models/reportRequest.model");
const moment = require("moment-timezone");
const { SERVER_URL } = require("../../config/server.config");
const { default: axios } = require("axios");
const FormData = require("form-data");

const transactionReportUtil = async (query, body, user, reqId) => {
  try {
    const response = await transactionReport(query, body, user);

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
  }
};

const transactionReport = async (query, body, user) => {
  try {
    const {
      adjustmentNo,
      adType,
      toDate,
      fromDate,
      stockType,
      transactionFor,
    } = body;

    // Ensure user exists
    if (!user?._id) throw new Error("Invalid user");

    // Building the filter object
    const filter = {
      distributorId: new mongoose.Types.ObjectId(user._id),
    };

    // Transaction type filtering
    if (transactionFor) {
      filter.transactionType = transactionFor;
    }

    // Date filtering
    if (fromDate && toDate) {
      const startOfDay = new Date(fromDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(toDate);
      endOfDay.setHours(23, 59, 59, 999);

      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    } else {
      throw new Error("Date range is required");
    }

    // Type filtering (In/Out)
    if (adType) {
      filter.type = adType;
    }

    // Stock type filtering
    if (stockType) {
      filter.stockType = stockType;
    }

    // Adjustment number filtering
    if (adjustmentNo) {
      filter.transactionId = adjustmentNo;
    }

    // Fetch transactions with filters applied, populate product details
    const transactions = await Transaction.find(filter)
      .populate({
        path: "productId", // Assuming productId is the reference to the Product model
        select: "name product_code", // Select necessary fields only
      })
      .sort({ createdAt: -1 }) // Sort by creation date, descending
      .lean(); // Return plain JS objects for better performance

    // Check if no transactions were found
    if (!transactions || transactions.length === 0) {
      throw new Error("No transactions found for the given filters.");
    }

    // Map the data to CSV format
    const csvData = transactions?.map((transaction) => ({
      "Adjustment No": transaction?.transactionId,
      "Product Code": transaction?.productId?.product_code,
      "Product Name": transaction?.productId?.name,
      "Adjustment Date": moment(transaction?.createdAt)
        ?.tz("Asia/Kolkata")
        ?.format("DD-MM-YYYY hh:mm A"),
      "Adjustment Type": transaction?.type,
      "Stock Type": transaction?.stockType,
      "Adjustment Quantity": transaction?.qty,
      Remarks: transaction?.description,
    }));

    // Define the fields to be exported in the CSV
    const fields = [
      { label: "Adjustment No", value: "Adjustment No" },
      { label: "Product Code", value: "Product Code" },
      { label: "Product Name", value: "Product Name" },
      { label: "Adjustment Date", value: "Adjustment Date" },
      { label: "Adjustment Type", value: "Adjustment Type" },
      { label: "Stock Type", value: "Stock Type" },
      { label: "Adjustment Quantity", value: "Adjustment Quantity" },
      { label: "Remarks", value: "Remarks" },
    ];

    // Create CSV using the data and fields
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    // Save the CSV file to the server temporarily
    const filePath = path.join(__dirname, "transactions.csv");
    fs.writeFileSync(filePath, csv);

    // Upload CSV file to Cloudinary
    // const result = await cloudinary.uploader.upload(filePath, {
    //   resource_type: "raw",
    //   public_id: `transactions-${Date.now()}`,
    //   folder: "lux-dms",
    // });

    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `transactions-${Date.now()}`);
    const CLOUDINARY_UPLOAD_URL = `${SERVER_URL}/api/v1/cloudinary/upload`;

    const result = await axios.post(CLOUDINARY_UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Remove the temporary file after upload
    fs.unlinkSync(filePath);

    // Return the generated CSV link and other relevant information
    return {
      csvLink: result.data?.secure_url,
      count: transactions.length,
      query: query,
      body: body,
    };
  } catch (error) {
    // Handle any errors and return a relevant message
    throw new Error(
      error?.message ||
        "Something went wrong while generating the transaction report."
    );
  }
};

module.exports = { transactionReportUtil };
