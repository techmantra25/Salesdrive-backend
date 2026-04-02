const OrderEntry = require("../../models/orderEntry.model");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const mongoose = require("mongoose");
const ReportRequest = require("../../models/reportRequest.model");
const moment = require("moment-timezone");
const Distributor = require("../../models/distributor.model");
const Retailer = require("../../models/outletApproved.model");
const { default: axios } = require("axios");
const FormData = require("form-data");
const { SERVER_URL } = require("../../config/server.config");

// Utility function to check if a string is a valid ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const orderEntryReportUtil = async (query, body, user, reqId) => {
  try {
    const response = await orderEntryReport(query, body, user);

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

const orderEntryReport = async (query, body, user) => {
  try {
    const {
      orderNo,
      fromDate,
      toDate,
      orderType,
      paymentMode,
      retailerId,
      salesmanName, // Salesman Name Filter
      routeId, // Route ID Filter
      orderSource, // Order Source Filter
      status,
    } = body;

    // Ensure user exists
    if (!user?._id) throw new Error("Invalid user");

    // Building the filter object
    const filter = {
      distributorId: new mongoose.Types.ObjectId(user._id),
    };

    // Order No filtering
    if (orderNo) {
      filter.orderNo = orderNo;
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

    // Order Type filtering
    if (orderType) {
      filter.orderType = orderType;
    }

    // Payment Mode filtering
    if (paymentMode) {
      filter.paymentMode = paymentMode;
    }

    // Retailer ID filtering
    if (retailerId && isValidObjectId(retailerId)) {
      filter.retailerId = new mongoose.Types.ObjectId(retailerId);
    }

    // Salesman Name filtering
    if (salesmanName && isValidObjectId(salesmanName)) {
      filter.salesmanName = new mongoose.Types.ObjectId(salesmanName);
    }

    // Route ID filtering
    if (routeId && isValidObjectId(routeId)) {
      filter.routeId = new mongoose.Types.ObjectId(routeId);
    }

    // Order Source filtering
    if (orderSource) {
      filter.orderSource = orderSource;
    }

    // Status filtering
    if (status) {
      filter.status = status;
    }

    // Fetch order entries with filters applied
    const orderEntries = await OrderEntry.find(filter)
      .populate({
        path: "lineItems.product", // Assuming product is the reference to the Product model
        select: "name product_code", // Select necessary fields only
      })
      .populate({
        path: "salesmanName",
        select: "name empId", // Assuming name is part of the Employee model
      })
      .populate({
        path: "retailerId", // Populating the retailer details
        select: "", // Selecting the outlet name
      })
      .populate({
        path: "routeId", // Populating the route details
        select: "", // Selecting the route name
      })
      .sort({ createdAt: -1 }) // Sort by creation date, descending
      .lean(); // Return plain JS objects for better performance

    // Check if no orders were found
    if (!orderEntries || orderEntries.length === 0) {
      throw new Error("No orders found for the given filters.");
    }

    // Map the data to CSV format with conditional CGST, SGST, and IGST
    const csvData = orderEntries.map((order) => {
      let TotalOrderQuantity = order?.lineItems?.reduce((acc, item) => {
        return acc + item?.oderQty;
      }, 0);

      return {
        "Order No": order?.orderNo,
        "Salesman Name": order?.salesmanName?.name,
        "Order Date": moment(order?.createdAt)
          ?.tz("Asia/Kolkata")
          ?.format("DD-MM-YYYY, hh:mm A"),
        "Order Type": order?.orderType,
        "Order Source": order?.orderSource,
        "Payment Mode": order?.paymentMode,
        "Retailer UID": order?.retailerId?.outletUID,
        "Retailer Name": order?.retailerId?.outletName,
        "Route Code": order?.routeId?.code,
        "Route Name": order?.routeId?.name,
        "Total Lines": order?.totalLines,
        "Total Quantity": TotalOrderQuantity,
        "Gross Amount": order?.grossAmount,
        "Scheme Discount": order?.schemeDiscount,
        "Distributor Discount": order?.distributorDiscount,
        "Taxable Amount": order?.taxableAmount,
        CGST: order?.cgst ?? 0,
        SGST: order?.sgst ?? 0,
        IGST: order?.igst ?? 0,
        "Invoice Amount": order?.invoiceAmount,
        "Round Off Amount": order?.roundOffAmount,
        "Net Amount": order?.netAmount,
        "Total Base Points": order?.totalBasePoints,
        Status: order?.status,
      };
    });

    // Define the fields to be exported in the CSV
    const commonFields = [
      { label: "Order No", value: "Order No" },
      { label: "Salesman Name", value: "Salesman Name" },
      { label: "Order Date", value: "Order Date" },
      { label: "Order Type", value: "Order Type" },
      { label: "Order Source", value: "Order Source" },
      { label: "Payment Mode", value: "Payment Mode" },
      { label: "Retailer UID", value: "Retailer UID" },
      { label: "Retailer Name", value: "Retailer Name" },
      { label: "Route Code", value: "Route Code" },
      { label: "Route Name", value: "Route Name" },
      { label: "Total Quantity", value: "Total Quantity" },
      { label: "Total Lines", value: "Total Lines" },
      { label: "Total Base Points", value: "Total Base Points" },
      { label: "Gross Amount", value: "Gross Amount" },
      { label: "Scheme Discount", value: "Scheme Discount" },
      { label: "Distributor Discount", value: "Distributor Discount" },
      { label: "Taxable Amount", value: "Taxable Amount" },
      { label: "CGST", value: "CGST" },
      { label: "SGST", value: "SGST" },
      { label: "IGST", value: "IGST" },
      { label: "Invoice Amount", value: "Invoice Amount" },
      { label: "Round Off Amount", value: "Round Off Amount" },
      { label: "Net Amount", value: "Net Amount" },
      { label: "Status", value: "Status" },
    ];

    // Combine common fields with the dynamically determined tax fields

    const fields = [...commonFields];

    // Create CSV using the data and fields
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    // Save the CSV file to the server temporarily
    const filePath = path.join(__dirname, "order-entries.csv");
    fs.writeFileSync(filePath, csv);

    // Upload CSV file to Cloudinary
    // const result = await cloudinary.uploader.upload(filePath, {
    //   resource_type: "raw",
    //   public_id: `order-entries-${Date.now()}`,
    //   folder: "lux-dms",
    // });

    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `order-entries-${Date.now()}`);
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
      count: orderEntries.length,
      query: query,
      body: body,
    };
  } catch (error) {
    // Handle any errors and return a relevant message
    throw new Error(
      error?.message ||
        "Something went wrong while generating the order entry report."
    );
  }
};

module.exports = { orderEntryReportUtil };
