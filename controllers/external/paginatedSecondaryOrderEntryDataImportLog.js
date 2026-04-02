const asyncHandler = require("express-async-handler");
const SecondaryOrderEntryLog = require("../../models/SecondaryOrderEntryLogSchema");
const OrderEntry = require("../../models/orderEntry.model");

const paginatedSecondaryOrderEntryDataImportLog = asyncHandler(
  async (req, res) => {
    try {
      let {
        page = 1,
        limit = 10,
        search,
        fromDate,
        toDate,
        status,
        dbCode,
        originalStartDate,
        originalEndDate,
      } = req.query;
      page = Number(page);
      limit = Number(limit);

      let query = {};

      // Date filter
      if (fromDate || toDate) {
        query.updatedAt = {};
        if (fromDate) {
          const startOfDay = new Date(fromDate);
          startOfDay.setHours(0, 0, 0, 0); // Start of the day
          query.updatedAt.$gte = startOfDay;
          // console.log("From Date (startOfDay):", startOfDay.toISOString());
        }
        if (toDate) {
          const endOfDay = new Date(toDate);
          endOfDay.setHours(23, 59, 59, 999); // End of the day (inclusive milliseconds)
          query.updatedAt.$lte = endOfDay;
          // console.log("To Date (endOfDay):", endOfDay.toISOString());
        }
      }

       // Helper function to convert YYYY-MM-DD to DD/MM/YYYY
      const convertDateFormat = (dateStr) => {
        const [year, month, day] = dateStr.split('-');
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
          const startParts = startDateFormatted.split('/');
          const endParts = endDateFormatted.split('/');
          
          // For simplicity, if both dates are in the same month/year, use a range
          if (startParts[1] === endParts[1] && startParts[2] === endParts[2]) {
            const dayStart = parseInt(startParts[0]);
            const dayEnd = parseInt(endParts[0]);
            const dayPattern = Array.from(
              { length: dayEnd - dayStart + 1 }, 
              (_, i) => (dayStart + i).toString().padStart(2, '0')
            ).join('|');
            
            dateQueries.push({
              searchKey: { 
                $regex: `"Order_Date":"(${dayPattern})/${startParts[1]}/${startParts[2]}"`, 
                $options: "i" 
              }
            });
          } else {
            // For different months/years, search for individual dates
            dateQueries.push({
              searchKey: { 
                $regex: `"Order_Date":"${startDateFormatted}"`, 
                $options: "i" 
              }
            });
            dateQueries.push({
              searchKey: { 
                $regex: `"Order_Date":"${endDateFormatted}"`, 
                $options: "i" 
              }
            });
          }
        } else if (originalStartDate) {
          const startDateFormatted = convertDateFormat(originalStartDate);
          dateQueries.push({
            searchKey: { 
              $regex: `"Order_Date":"${startDateFormatted}"`, 
              $options: "i" 
            }
          });
        } else if (originalEndDate) {
          const endDateFormatted = convertDateFormat(originalEndDate);
          dateQueries.push({
            searchKey: { 
              $regex: `"Order_Date":"${endDateFormatted}"`, 
              $options: "i" 
            }
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
            $options: "i" 
          }
        });
      }

      // Search filter (on Order_Id, OrderStatus, ErrorLog)
      // IMPORTANT: If you want to search OrderStatus or ErrorLog, add them to the $or array
      if (search) {
        // find matching OrderEntry ids
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
          ]
        };

        query.$and = query.$and || [];
        query.$and.push(searchQuery);
      }

      // Status filter
      if (status && status !== "default") {
        // Added check for 'default' string from frontend
        query.OrderStatus = status;
      }

      // console.log("Constructed MongoDB Query:", JSON.stringify(query, null, 2));

      // Get filtered count
      const filteredCount = await SecondaryOrderEntryLog.countDocuments(query);
      // console.log("Filtered Count:", filteredCount);

      // Get total count (without filters)
      const totalActiveCount = await SecondaryOrderEntryLog.countDocuments({}); // Use an empty object for total count
      // console.log("Total Active Count (All documents):", totalActiveCount);

      // Get paginated results
      const result = await SecondaryOrderEntryLog.find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("orderId");

      // console.log("Number of results found:", result.length);
      // console.log("Results:", result); // Log results to inspect if they match expectations

      return res.status(200).json({
        status: 200,
        message: "Secondary Order Entry Data Import Log",
        data: result,
        pagination: {
          currentPage: page,
          limit,
          totalPages: Math.ceil(filteredCount / limit),
          filteredCount,
          totalActiveCount,
        },
      });
    } catch (error) {
      console.error(
        "Error in paginatedSecondaryOrderEntryDataImportLog:",
        error
      );
      res.status(400);
      throw error;
    }
  }
);

module.exports = { paginatedSecondaryOrderEntryDataImportLog };
