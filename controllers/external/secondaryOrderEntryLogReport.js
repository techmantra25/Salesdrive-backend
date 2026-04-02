const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OrderEntry = require("../../models/orderEntry.model");
const Distributor = require("../../models/distributor.model");

const secondaryOrderEntryLogReport = asyncHandler(async (req, res) => {
  try {
    let {
      search,
      fromDate,
      toDate,
      status,
      dbCode,
      originalStartDate,
      originalEndDate,
    } = req.query;

    let query = {};

    // Date filter (for createdAt/updatedAt)
    if (fromDate || toDate) {
      query.updatedAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        query.updatedAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.updatedAt.$lte = endOfDay;
      }
    }

    // Helper function to convert YYYY-MM-DD to DD/MM/YYYY
    const convertDateFormat = (dateStr) => {
      const [year, month, day] = dateStr.split("-");
      return `${day}/${month}/${year}`;
    };

    // Original date range filter (for Order_Date in OrderData)
    if (originalStartDate || originalEndDate) {
      const dateQueries = [];

      if (originalStartDate && originalEndDate) {
        // Convert both dates to DD/MM/YYYY format
        const startDateFormatted = convertDateFormat(originalStartDate);
        const endDateFormatted = convertDateFormat(originalEndDate);

        // Create a more comprehensive date range regex
        const startParts = startDateFormatted.split("/");
        const endParts = endDateFormatted.split("/");

        // For simplicity, if both dates are in the same month/year, use a range
        if (startParts[1] === endParts[1] && startParts[2] === endParts[2]) {
          const dayStart = parseInt(startParts[0]);
          const dayEnd = parseInt(endParts[0]);
          const dayPattern = Array.from(
            { length: dayEnd - dayStart + 1 },
            (_, i) => (dayStart + i).toString().padStart(2, "0")
          ).join("|");

          dateQueries.push({
            searchKey: {
              $regex: `"Order_Date":"(${dayPattern})/${startParts[1]}/${startParts[2]}"`,
              $options: "i",
            },
          });
        } else {
          // For different months/years, search for individual dates
          dateQueries.push({
            searchKey: {
              $regex: `"Order_Date":"${startDateFormatted}"`,
              $options: "i",
            },
          });
          dateQueries.push({
            searchKey: {
              $regex: `"Order_Date":"${endDateFormatted}"`,
              $options: "i",
            },
          });
        }
      } else if (originalStartDate) {
        const startDateFormatted = convertDateFormat(originalStartDate);
        dateQueries.push({
          searchKey: {
            $regex: `"Order_Date":"${startDateFormatted}"`,
            $options: "i",
          },
        });
      } else if (originalEndDate) {
        const endDateFormatted = convertDateFormat(originalEndDate);
        dateQueries.push({
          searchKey: {
            $regex: `"Order_Date":"${endDateFormatted}"`,
            $options: "i",
          },
        });
      }

      if (dateQueries.length > 0) {
        query.$and = query.$and || [];
        query.$and.push({ $or: dateQueries });
      }
    }

    // dbCode filter (matches DistributerCode in OrderData)
    if (dbCode) {
      query.$and = query.$and || [];
      query.$and.push({
        searchKey: {
          $regex: `"DistributerCode":"${dbCode}"`,
          $options: "i",
        },
      });
    }

    // Search filter (on Order_Id, OrderStatus, ErrorLog)
    if (search) {
      // Find matching OrderEntry ids
      const matchingOrders = await OrderEntry.find({
        orderNo: { $regex: search, $options: "i" },
      }).select("_id");

      const matchingOrderIds = matchingOrders.map((order) => order._id);

      const searchQuery = {
        $or: [
          { Order_Id: { $regex: search, $options: "i" } },
          { ErrorLog: { $regex: search, $options: "i" } },
          { searchKey: { $regex: search, $options: "i" } },
          { orderId: { $in: matchingOrderIds } },
        ],
      };

      query.$and = query.$and || [];
      query.$and.push(searchQuery);
    }

    // Status filter
    if (status && status !== "default") {
      query.OrderStatus = status;
    }

    // Prepare CSV headers
    const headers = [
      "DB Code",
      "Db Name",
      "Original Order Date",
      "SFA Order Id",
      "DMS Order No",
      "Order Import Status",
      "Error Log",
      "Skipped Products",
      "Skipped Products Reason",
      "Order Last Processed Date",
    ];

    const fileName = `secondary-order-entry-log-report-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const csvStream = format({ headers });
    csvStream.pipe(res);

    // Fetch filtered logs with population
    const logs = await SecondaryOrderEntryLog.find(query)
      .sort({ updatedAt: -1 })
      .populate({
        path: "orderId",
        model: "OrderEntry",
        select: "orderNo distributorId",
        populate: {
          path: "distributorId",
          model: "Distributor",
          select: "name dbCode",
        },
      });

    // Get unique dbCodes from OrderData for distributor lookup
    const dbCodes = [
      ...new Set(
        logs.map((log) => log.OrderData?.DistributerCode).filter(Boolean)
      ),
    ];

    // Fetch distributors by dbCode
    const distributors = await Distributor.find({
      dbCode: { $in: dbCodes },
    }).select("name dbCode");

    // Create a map for quick lookup
    const distributorMap = {};
    distributors.forEach((dist) => {
      distributorMap[dist.dbCode] = dist.name;
    });

    // Write logs to CSV
    logs.forEach((log) => {
      const orderData = log.OrderData || {};
      const skippedOrders = orderData.skippedOrders || [];

      // Get distributor name - first try from populated orderId, then from dbCode lookup
      const distributorName =
        log.orderId?.distributorId?.name ||
        distributorMap[orderData.DistributerCode] ||
        "";

      // If there are skipped orders, create separate rows for each
      if (skippedOrders.length > 0) {
        skippedOrders.forEach((skippedOrder) => {
          csvStream.write({
            "DB Code": orderData.DistributerCode || "",
            "Db Name": distributorName,
            "Original Order Date": orderData.Order_Date || "",
            "SFA Order Id": log.Order_Id || "",
            "DMS Order No": log.orderId?.orderNo || "",
            "Order Import Status": log.OrderStatus || "",
            "Error Log": log.ErrorLog || "",
            "Skipped Products": skippedOrder.Variant_Extension1 || "",
            "Skipped Products Reason": skippedOrder.reason || "",
            "Order Last Processed Date": log.updatedAt
              ? moment(log.updatedAt)
                  .tz("Asia/Kolkata")
                  .format("DD-MM-YYYY hh:mm:ss A")
              : "",
          });
        });
      } else {
        // If no skipped orders, create a single row
        csvStream.write({
          "DB Code": orderData.DistributerCode || "",
          "Db Name": distributorName,
          "Original Order Date": orderData.Order_Date || "",
          "SFA Order Id": log.Order_Id || "",
          "DMS Order No": log.orderId?.orderNo || "",
          "Order Import Status": log.OrderStatus || "",
          "Error Log": log.ErrorLog || "",
          "Skipped Products": "",
          "Skipped Products Reason": "",
          "Order Last Processed Date": log.updatedAt
            ? moment(log.updatedAt)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY hh:mm:ss A")
            : "",
        });
      }
    });

    csvStream.end();
  } catch (error) {
    console.error("Secondary Order Entry Log Report Error:", error.message);
    res.status(500).json({
      status: 500,
      message: "Failed to generate secondary order entry log report",
      error: error.message,
    });
  }
});

module.exports = { secondaryOrderEntryLogReport };
