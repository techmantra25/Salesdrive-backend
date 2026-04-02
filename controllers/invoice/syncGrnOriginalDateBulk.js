const GrnLOG = require("../../models/grnLogSchema");
const Invoice = require("../../models/invoice.model");
const asyncHandler = require("express-async-handler");

const syncGrnOriginalDateBulk = asyncHandler(async (req, res) => {
  try {
    console.log("=== BULK GRN SYNC STARTED ===");
    console.log("Query Parameters:", req.query);

    let {
      page = 1,
      limit = 10,
      status,
      invoiceNo,
      fromDate,
      toDate,
      distributorId,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;

    console.log("Parsed Parameters:", { page, limit, skip, status, distributorId });

    // Build the filter object
    let filter = {};

    if (status) {
      filter.status = status;
    }

    if (invoiceNo) {
      filter.invoiceNo = { $regex: invoiceNo, $options: "i" };
    }

    if (distributorId) {
      filter.distributorId = distributorId;
    }

    if (fromDate || toDate) {
      filter.date = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.date.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.date.$lte = endOfDay;
      }
    }

    // Filter for invoices without GRNFKDATE OR with null GRNFKDATE
    filter.$or = [
      { GRNFKDATE: { $exists: false } },
      { GRNFKDATE: null }
    ];

    console.log("Filter Applied:", JSON.stringify(filter, null, 2));

    // Get total count for reporting
    const totalCount = await Invoice.countDocuments(filter);
    console.log(`Total invoices matching filter: ${totalCount}`);

    // Fetch invoices that need GRN date sync
    const invoices = await Invoice.find(filter)
      .select('_id invoiceNo distributorId status date GRNFKDATE') // Only select needed fields
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean(); // Use lean() for better performance

    console.log(`Found ${invoices.length} invoices to process on page ${page}`);

    if (!invoices || invoices.length === 0) {
      console.log("No invoices found to sync");
      return res.status(200).json({
        status: 200,
        message: "No invoices found to sync",
        data: {
          totalProcessed: 0,
          successCount: 0,
          failedCount: 0,
          errors: [],
          totalAvailable: totalCount,
        },
      });
    }

    // Process each invoice
    const results = {
      totalProcessed: invoices.length,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errors: [],
      updatedInvoices: [],
    };

    console.log("\n--- Starting Invoice Processing ---");

    // Use Promise.all for parallel processing (faster)
    const promises = invoices.map(async (invoice) => {
      console.log(`\nProcessing Invoice: ${invoice.invoiceNo} (ID: ${invoice._id})`);
      
      try {
        // Find corresponding GRN log
        const grnLog = await GrnLOG.findOne({ invoiceId: invoice._id }).lean();
        
        if (!grnLog) {
          console.log(`❌ GRN Log not found for invoice ${invoice.invoiceNo}`);
          return {
            success: false,
            invoiceId: invoice._id,
            invoiceNo: invoice.invoiceNo,
            error: "GRN Log not found",
          };
        }

        const fkDate = grnLog?.GrnData?.Fkdat;
        console.log(`Raw FKDAT from GRN Log: ${fkDate}`);
        
        if (!fkDate || typeof fkDate !== "string" || fkDate.length < 8) {
          console.log(`❌ FKDAT invalid for invoice ${invoice.invoiceNo}`);
          return {
            success: false,
            invoiceId: invoice._id,
            invoiceNo: invoice.invoiceNo,
            error: `FKDAT invalid or missing: ${fkDate}`,
          };
        }

        // Parse YYYYMMDD - add validation
        const year = parseInt(fkDate.substring(0, 4), 10);
        const month = parseInt(fkDate.substring(4, 6), 10) - 1; // 0-based
        const day = parseInt(fkDate.substring(6, 8), 10);

        // Validate parsed values
        if (isNaN(year) || isNaN(month) || isNaN(day) || 
            year < 2000 || year > 2100 || 
            month < 0 || month > 11 || 
            day < 1 || day > 31) {
          console.log(`❌ Invalid date components for invoice ${invoice.invoiceNo}`);
          return {
            success: false,
            invoiceId: invoice._id,
            invoiceNo: invoice.invoiceNo,
            error: `Invalid date components: Y=${year}, M=${month + 1}, D=${day}`,
          };
        }

        console.log(`Parsed Date Components: Year=${year}, Month=${month + 1}, Day=${day}`);

        // Create Date at midnight UTC
        const parsedDate = new Date(Date.UTC(year, month, day));
        console.log(`Created Date Object: ${parsedDate.toISOString()}`);

        // Update invoice using findByIdAndUpdate for better performance
        const updatedInvoice = await Invoice.findByIdAndUpdate(
          invoice._id,
          { GRNFKDATE: parsedDate },
          { new: true, runValidators: true }
        );

        if (!updatedInvoice) {
          console.log(`❌ Failed to update invoice ${invoice.invoiceNo}`);
          return {
            success: false,
            invoiceId: invoice._id,
            invoiceNo: invoice.invoiceNo,
            error: "Invoice update failed",
          };
        }

        console.log(`✅ Successfully updated invoice ${invoice.invoiceNo} with GRNFKDATE: ${parsedDate.toISOString()}`);
        
        return {
          success: true,
          invoiceId: invoice._id,
          invoiceNo: invoice.invoiceNo,
          GRNFKDATE: parsedDate,
        };

      } catch (error) {
        console.log(`❌ Error processing invoice ${invoice.invoiceNo}:`, error.message);
        return {
          success: false,
          invoiceId: invoice._id,
          invoiceNo: invoice.invoiceNo,
          error: error.message,
        };
      }
    });

    // Wait for all updates to complete
    const processResults = await Promise.all(promises);

    // Aggregate results
    processResults.forEach(result => {
      if (result.success) {
        results.successCount++;
        results.updatedInvoices.push({
          invoiceId: result.invoiceId,
          invoiceNo: result.invoiceNo,
          GRNFKDATE: result.GRNFKDATE,
        });
      } else {
        results.failedCount++;
        results.errors.push({
          invoiceId: result.invoiceId,
          invoiceNo: result.invoiceNo,
          error: result.error,
        });
      }
    });

    console.log("\n=== BULK GRN SYNC COMPLETED ===");
    console.log("Results Summary:", {
      totalProcessed: results.totalProcessed,
      successCount: results.successCount,
      failedCount: results.failedCount,
      totalAvailable: totalCount,
      currentPage: page,
      remainingPages: Math.ceil((totalCount - skip - limit) / limit),
    });

    return res.status(200).json({
      status: 200,
      message: "Bulk GRN original date sync completed",
      data: {
        ...results,
        pagination: {
          currentPage: page,
          pageSize: limit,
          totalRecords: totalCount,
          processedRecords: invoices.length,
          hasMore: skip + limit < totalCount,
        },
      },
    });

  } catch (error) {
    console.log("❌ FATAL ERROR:", error);
    return res.status(500).json({ 
      status: 500, 
      message: "Server Error",
      error: error.message 
    });
  }
});

module.exports = syncGrnOriginalDateBulk;