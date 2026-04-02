const asyncHandler = require("express-async-handler");
const Invoice = require("../../models/invoice.model");
const Distributor = require("../../models/distributor.model");

const disPaginatedInvoiceList = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      status,
      invoiceNo,
      fromDate,
      toDate,
      grnFromDate,
      grnToDate,
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    const skip = (page - 1) * limit;
    const distributorId = req?.user?._id;

    // ============================
    // GET DISTRIBUTOR DETAILS
    // ============================
    const distributor = await Distributor.findById(distributorId);
    if (!distributor) {
      return res.status(404).json({
        status: 404,
        message: "Distributor not found",
      });
    }

    console.log("==================== DISTRIBUTOR INFO ====================");
    console.log("Distributor ID:", distributorId);
    console.log("Distributor Name:", distributor.name);
    console.log("primaryInvoiceType:", distributor.primaryInvoiceType);
    console.log("oldDate:", distributor.oldDate);
    console.log("createdAt:", distributor.createdAt);
    console.log("=========================================================");

    // ============================
    // DETERMINE WHICH DATE TO USE FOR FILTERING
    // ============================
    const primaryInvoiceType = distributor?.primaryInvoiceType;

    // Use oldDate if primaryInvoiceType is "All", otherwise use createdAt
    let effectiveDate;
    if (primaryInvoiceType === "All") {
      // When primaryInvoiceType is "All", use oldDate if available, otherwise fallback to createdAt
      effectiveDate = distributor.oldDate
        ? new Date(distributor.oldDate)
        : new Date(distributor.createdAt);
      console.log(
        "✅ primaryInvoiceType is 'All' - Using oldDate for ALL statuses",
      );
    } else {
      effectiveDate = new Date(distributor.createdAt);
      console.log("❌ primaryInvoiceType is NOT 'All' - Using createdAt");
    }
    // Normalize to start of day
    effectiveDate.setHours(0, 0, 0, 0);

    console.log("==================== EFFECTIVE DATE ====================");
    console.log("Effective Date (after normalization):", effectiveDate);
    console.log("=========================================================");

    // ============================
    // PREPARE REQUESTED DATE RANGE (if any)
    // ============================
    let requestedDateRange = null;
    if (fromDate || toDate) {
      requestedDateRange = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        requestedDateRange.date = requestedDateRange.date || {};
        requestedDateRange.date.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        requestedDateRange.date = requestedDateRange.date || {};
        requestedDateRange.date.$lte = end;
      }
      console.log(
        "==================== REQUESTED DATE RANGE ====================",
      );
      console.log("From Date:", fromDate);
      console.log("To Date:", toDate);
      console.log(
        "Requested Date Range Object:",
        JSON.stringify(requestedDateRange, null, 2),
      );
      console.log(
        "=============================================================",
      );
    }

    // grn date range filter handel
    let grnDateRange = null;

    if (grnFromDate || grnToDate) {
      grnDateRange = {};
      // setting start date range
      if (grnFromDate) {
        const start = new Date(grnFromDate);
        start.setHours(0, 0, 0, 0);
        grnDateRange.$gte = start;
      }
      // setting the end date range
      if (grnToDate) {
        const end = new Date(grnToDate);
        end.setHours(23, 59, 59, 999);
        grnDateRange.$lte = end;
      }
    }

    // ============================
    // BUILD BASE MATCH (applies to all branches)
    // ============================
    const baseMatch = {};
    if (distributorId) baseMatch.distributorId = distributorId;
    if (invoiceNo) baseMatch.invoiceNo = { $regex: invoiceNo, $options: "i" };
    if (grnDateRange) baseMatch.grnDate = grnDateRange;

    console.log("==================== BASE MATCH ====================");
    console.log("Base Match:", JSON.stringify(baseMatch, null, 2));
    console.log("====================================================");

    // GRNFKDATE allowance used for non-confirmed branch
    const grnfkCondition = {
      $or: [
        { GRNFKDATE: null },
        { GRNFKDATE: { $ne: null, $gte: effectiveDate } },
      ],
    };

    console.log("==================== GRNFK CONDITION ====================");
    console.log("GRNFK Condition:", JSON.stringify(grnfkCondition, null, 2));
    console.log("========================================================");

    // ============================
    // BUILD the "All" filter
    // ============================
    const buildAllFilter = () => {
      // When primaryInvoiceType is "All", apply date filter to CONFIRMED invoices too
      let confirmedBranch;
      if (primaryInvoiceType === "All") {
        // For "All" type: Confirmed invoices must also have date >= effectiveDate (oldDate)
        const confirmedDateReq = {};
        confirmedDateReq.$gte = effectiveDate;

        if (
          requestedDateRange &&
          requestedDateRange.date &&
          requestedDateRange.date.$gte
        ) {
          const reqFrom = requestedDateRange.date.$gte;
          if (reqFrom > effectiveDate) confirmedDateReq.$gte = reqFrom;
        }

        if (
          requestedDateRange &&
          requestedDateRange.date &&
          requestedDateRange.date.$lte
        ) {
          confirmedDateReq.$lte = requestedDateRange.date.$lte;
        }

        confirmedBranch = {
          $and: [{ status: "Confirmed" }, { date: confirmedDateReq }],
        };
        console.log(
          " Applying date filter to Confirmed invoices (primaryInvoiceType=All)",
        );
      } else {
        // For non-"All" type: Original logic - no date restriction on Confirmed
        confirmedBranch = requestedDateRange
          ? { $and: [{ status: "Confirmed" }, requestedDateRange] }
          : { status: "Confirmed" };
        console.log(" No date filter on Confirmed invoices (original logic)");
      }

      const nonConfirmedDateReq = {};
      nonConfirmedDateReq.$gte = effectiveDate;

      if (
        requestedDateRange &&
        requestedDateRange.date &&
        requestedDateRange.date.$gte
      ) {
        const reqFrom = requestedDateRange.date.$gte;
        if (reqFrom > effectiveDate) nonConfirmedDateReq.$gte = reqFrom;
      }

      if (
        requestedDateRange &&
        requestedDateRange.date &&
        requestedDateRange.date.$lte
      ) {
        nonConfirmedDateReq.$lte = requestedDateRange.date.$lte;
      }

      const nonConfirmedBranch = {
        $and: [
          { status: { $in: ["In-Transit", "Ignored", "Partially-Adjusted"] } },
          { date: nonConfirmedDateReq },
          grnfkCondition,
        ],
      };

      console.log(
        "==================== ALL FILTER BRANCHES ====================",
      );
      console.log(
        "Confirmed Branch:",
        JSON.stringify(confirmedBranch, null, 2),
      );
      console.log(
        "Non-Confirmed Date Requirement:",
        JSON.stringify(nonConfirmedDateReq, null, 2),
      );
      console.log(
        "Non-Confirmed Branch:",
        JSON.stringify(nonConfirmedBranch, null, 2),
      );
      console.log(
        "============================================================",
      );

      return {
        $and: [baseMatch, { $or: [confirmedBranch, nonConfirmedBranch] }],
      };
    };

    const allFilter = buildAllFilter();

    console.log(
      "==================== ALL FILTER (COMPLETE) ====================",
    );
    console.log(JSON.stringify(allFilter, null, 2));
    console.log(
      "================================================================",
    );

    // ============================
    // BUILD finalFilter PER RULES
    // ============================
    let finalFilter = {};

    console.log(
      "==================== BUILDING FINAL FILTER ====================",
    );
    console.log("Status parameter:", status);

    if (status === "Confirmed") {
      // When primaryInvoiceType is "All", apply date >= oldDate filter for Confirmed too
      if (primaryInvoiceType === "All") {
        const confirmedDateReq = {};
        confirmedDateReq.$gte = effectiveDate;

        if (
          requestedDateRange &&
          requestedDateRange.date &&
          requestedDateRange.date.$gte
        ) {
          const reqFrom = requestedDateRange.date.$gte;
          if (reqFrom > effectiveDate) confirmedDateReq.$gte = reqFrom;
        }

        if (
          requestedDateRange &&
          requestedDateRange.date &&
          requestedDateRange.date.$lte
        ) {
          confirmedDateReq.$lte = requestedDateRange.date.$lte;
        }

        finalFilter = {
          ...baseMatch,
          status: "Confirmed",
          date: confirmedDateReq,
        };
        console.log(
          "Filter Type: Confirmed with date filter (primaryInvoiceType=All)",
        );
        console.log(
          "Confirmed Date Requirement:",
          JSON.stringify(confirmedDateReq, null, 2),
        );
      } else {
        // Original logic for non-"All" type
        finalFilter = {
          ...baseMatch,
          status: "Confirmed",
          ...(requestedDateRange || {}),
        };
        console.log("Filter Type: Confirmed (original logic)");
      }
    } else if (
      status &&
      (status === "In-Transit" ||
        status === "Ignored" ||
        status === "Partially-Adjusted")
    ) {
      let dateReq = { $gte: effectiveDate };

      if (
        requestedDateRange &&
        requestedDateRange.date &&
        requestedDateRange.date.$gte
      ) {
        const reqFrom = requestedDateRange.date.$gte;
        if (reqFrom > effectiveDate) dateReq.$gte = reqFrom;
      }

      if (
        requestedDateRange &&
        requestedDateRange.date &&
        requestedDateRange.date.$lte
      ) {
        dateReq.$lte = requestedDateRange.date.$lte;
      }

      finalFilter = {
        ...baseMatch,
        status: status,
        date: dateReq,
        $and: [grnfkCondition],
      };
      console.log("Filter Type: In-Transit or Ignored");
      console.log("Date Requirement:", JSON.stringify(dateReq, null, 2));
    } else {
      // no status -> same as allFilter
      finalFilter = allFilter;
      console.log("Filter Type: All (no status specified)");
    }

    console.log(
      "==================== FINAL FILTER (COMPLETE) ====================",
    );
    console.log(JSON.stringify(finalFilter, null, 2));
    console.log(
      "==================================================================",
    );

    // ============================
    // FETCH INVOICES (data page)
    // ============================
    const invoices = await Invoice.find(finalFilter)
      .skip(skip)
      .limit(limit)
      .sort({ date: -1 })
      .populate({ path: "distributorId", select: "" })
      .populate({
        path: "lineItems.product",
        select: "",
        populate: { path: "brand", select: "" },
      })
      .populate({ path: "lineItems.plant", select: "" });

    console.log("==================== QUERY RESULTS ====================");
    console.log("Number of invoices found:", invoices.length);
    if (invoices.length > 0) {
      console.log("First invoice date:", invoices[0].date);
      console.log("First invoice status:", invoices[0].status);
      console.log("First invoice number:", invoices[0].invoiceNo);
      console.log("Sample of invoice dates:");
      invoices.slice(0, 5).forEach((inv, idx) => {
        console.log(
          `  Invoice ${idx + 1}: ${inv.invoiceNo} - Date: ${
            inv.date
          } - Status: ${inv.status}`,
        );
      });
    }
    console.log("=======================================================");

    const totalCount = await Invoice.countDocuments({ distributorId });
    const totalFilteredCount = await Invoice.countDocuments(finalFilter);
    const allFilteredCount = await Invoice.countDocuments(allFilter);

    console.log("==================== COUNT RESULTS ====================");
    console.log("Total invoices for distributor:", totalCount);
    console.log("Total filtered count (current filter):", totalFilteredCount);
    console.log("All filtered count (All filter):", allFilteredCount);
    console.log("=======================================================");

    const isRBPMapped = distributor?.RBPSchemeMapped === "yes";

    // ============================
    // Decide totalCount for response
    // ============================
    let totalCountForResponse;
    if (!status) {
      totalCountForResponse = totalFilteredCount;
    } else {
      totalCountForResponse = allFilteredCount;
    }

    // ============================
    // PAGINATION OBJECT
    // ============================
    const pagination = {
      currentPage: page,
      limit,
      totalPages: Math.ceil(totalFilteredCount / limit),
      totalCount: totalCountForResponse,
      filteredCount: totalFilteredCount,
    };

    // ============================
    // RBP POINTS CALCULATION
    // ============================
    if (isRBPMapped) {
      const confirmedInvoicesFilter = { ...allFilter, status: "Confirmed" };
      const confirmedInvoices = await Invoice.find(
        confirmedInvoicesFilter,
      ).populate({
        path: "lineItems.product",
        select: "base_point",
      });

      let totalConfirmedInvoicesPoints = 0;
      confirmedInvoices.forEach((invoice) => {
        // invoice.lineItems.forEach((lineItem) => {
        //   const basePoint = parseFloat(lineItem.product?.base_point || 0);
        //   const receivedQty = lineItem.receivedQty || 0;
        //   totalConfirmedInvoicesPoints += basePoint * receivedQty;
        // });
        invoice.lineItems.forEach((li) => {
          if (li.adjustmentStatus !== "success") return;
          const basePoint = Number(li.product?.base_point || 0);
          totalConfirmedInvoicesPoints += basePoint * (li.receivedQty || 0);
        });
      });

      pagination.totalConfirmedInvoicesPoints = totalConfirmedInvoicesPoints;
    }

    const formattedInvoices = invoices.map((inv) => ({
      ...inv.toObject(),
      adjustmentSummary: inv.adjustmentSummary || null,
      grnStatus: inv.grnStatus || "pending",
    }));

    // ============================
    // SEND RESPONSE
    // ============================
    console.log("==================== SENDING RESPONSE ====================");
    console.log("Pagination:", JSON.stringify(pagination, null, 2));
    console.log("==========================================================");

    return res.status(200).json({
      status: 200,
      message: "Paginated invoice list",
      data: formattedInvoices,
      pagination,
    });
  } catch (error) {
    console.error("==================== ERROR ====================");
    console.error("Error message:", error?.message);
    console.error("Error stack:", error?.stack);
    console.error("===============================================");
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { disPaginatedInvoiceList };
