const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const { format } = require("fast-csv");

const Distributor = require("../../models/distributor.model");
const Invoice = require("../../models/invoice.model");
const Bill = require("../../models/bill.model");
const Brand = require("../../models/brand.model");

const usageReport = asyncHandler(async (req, res) => {
  try {
    const { fromDate, toDate, dbStatus = "all", distributorId = "all" } = req.body;
    const hasDateRange = fromDate && toDate;

    const startDate = hasDateRange
      ? moment.tz(fromDate, "Asia/Kolkata").startOf("day").toDate()
      : null;

    const endDate = hasDateRange
      ? moment.tz(toDate, "Asia/Kolkata").endOf("day").toDate()
      : null;

    /* ---------------- FETCH DISTRIBUTORS ---------------- */

    let distributors = await Distributor.find(
      {},
      { name: 1, dbCode: 1, createdAt: 1, openingStock: 1, brandId: 1 }
    ).lean();

    if (distributorId !== "all") {
      distributors = distributors.filter(
        (db) => db._id.toString() === distributorId
      );
    }
    /* ---------------- FETCH BRANDS ---------------- */

    const brands = await Brand.find({}, { name: 1 }).lean();
    const brandMap = {};
    brands.forEach(b => {
      brandMap[b._id.toString()] = b.name;
    });

    /* ---------------- AGGREGATE PURCHASE INVOICES ---------------- */

    const invoiceAggRaw = await Invoice.aggregate([
      { $match: { status: "Confirmed" } },
      {
        $group: {
          _id: "$distributorId",
          totalFromOnboard: { $sum: 1 },
          selectedRange: {
            $sum: {
              $cond: [
                hasDateRange
                  ? {
                    $and: [
                      { $gte: ["$date", startDate] },
                      { $lte: ["$date", endDate] }
                    ]
                  }
                  : false,
                1,
                0
              ]
            }
          },
          totalValueFromOnboard: { $sum: "$totalInvoiceAmount" },
          selectedRangeValue: {
            $sum: {
              $cond: [
                hasDateRange
                  ? {
                    $and: [
                      { $gte: ["$date", startDate] },
                      { $lte: ["$date", endDate] }
                    ]
                  }
                  : false,
                "$totalInvoiceAmount",
                0
              ]
            }
          },
          lastInvoiceDate: { $max: "$date" }
        }
      }
    ]);
    /* ---------------- AGGREGATE ALL PURCHASE INVOICES (ANY STATUS) ---------------- */

    const invoiceAllAggRaw = await Invoice.aggregate([
      ...(hasDateRange
        ? [
          {
            $match: {
              date: {
                $gte: startDate,
                $lte: endDate
              }
            }
          }
        ]
        : []),

      {
        $group: {
          _id: "$distributorId",
          totalInvoiceCountAllStatus: { $sum: 1 },
          totalInvoiceValueAllStatus: { $sum: "$totalInvoiceAmount" }
        }
      }
    ]);

    const invoiceAllAgg =
      distributorId === "all"
        ? invoiceAllAggRaw
        : invoiceAllAggRaw.filter(
          (i) => i._id && i._id.toString() === distributorId
        );

    const invoiceAllMap = {};

    invoiceAllAgg.forEach(i => {
      invoiceAllMap[i._id.toString()] = i;
    });

    const invoiceAgg =
      distributorId === "all"
        ? invoiceAggRaw
        : invoiceAggRaw.filter(
          (i) => i._id && i._id.toString() === distributorId
        );
    const invoiceMap = {};
    invoiceAgg.forEach(i => {
      invoiceMap[i._id.toString()] = i;
    });



    /* ---------------- AGGREGATE SALES BILLS ---------------- */

    const billAggRaw = await Bill.aggregate([
      {
        $group: {
          _id: "$distributorId",
          totalFromOnboard: { $sum: 1 },
          selectedRange: {
            $sum: {
              $cond: [
                hasDateRange
                  ? {
                    $and: [
                      { $gte: ["$createdAt", startDate] },
                      { $lte: ["$createdAt", endDate] }
                    ]
                  }
                  : false,
                1,
                0
              ]
            }
          },
          totalValueFromOnboard: { $sum: "$netAmount" },
          selectedRangeValue: {
            $sum: {
              $cond: [
                hasDateRange
                  ? {
                    $and: [
                      { $gte: ["$createdAt", startDate] },
                      { $lte: ["$createdAt", endDate] }
                    ]
                  }
                  : false,
                "$netAmount",
                0
              ]
            }
          },
          lastBillDate: { $max: "$createdAt" }
        }
      }
    ]);

    const billAgg =
      distributorId === "all"
        ? billAggRaw
        : billAggRaw.filter(
          (b) => b._id && b._id.toString() === distributorId
        );

    const billMap = {};
    billAgg.forEach(b => {
      billMap[b._id.toString()] = b;
    });

    /* ---------------- CSV SETUP ---------------- */

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=distributor_usage_report.csv"
    );
    res.setHeader("Content-Type", "text/csv");

    const csvStream = format({ headers: true });
    csvStream.pipe(res);

    /* ---------------- BUILD CSV ---------------- */

    for (const db of distributors) {
      const id = db._id.toString();

      const inv = invoiceMap[id] || {};
      const bill = billMap[id] || {};

      const invAll = invoiceAllMap[id] || {};

      const totalInvoiceCountAllStatus =
        invAll.totalInvoiceCountAllStatus || 0;

      const totalInvoiceValueAllStatus =
        invAll.totalInvoiceValueAllStatus || 0;

      const purchaseInvoiceFromOnboard = inv.totalFromOnboard || 0;
      const purchaseInvoiceSelectedRange = hasDateRange
        ? inv.selectedRange || 0
        : inv.totalFromOnboard || 0;

      const purchaseInvoiceValueFromOnboard =
        inv.totalValueFromOnboard || 0;
      const purchaseInvoiceValueSelectedRange = hasDateRange
        ? inv.selectedRangeValue || 0
        : inv.totalValueFromOnboard || 0;

      const salesBillFromOnboard = bill.totalFromOnboard || 0;
      const salesBillSelectedRange = hasDateRange
        ? bill.selectedRange || 0
        : bill.totalFromOnboard || 0;

      const salesBillValueFromOnboard =
        bill.totalValueFromOnboard || 0;
      const salesBillValueSelectedRange = hasDateRange
        ? bill.selectedRangeValue || 0
        : bill.totalValueFromOnboard || 0;

      const hasAnyActivity =
        purchaseInvoiceFromOnboard > 0 || salesBillFromOnboard > 0;
      const distributorStatus = hasAnyActivity ? "Active" : "Inactive";

      if (
        (dbStatus === "active" && !hasAnyActivity) ||
        (dbStatus === "inactive" && hasAnyActivity)
      ) {
        continue;
      }

      /* -------- LAST USAGE LOGIC -------- */

      const lastInvoiceDate = inv.lastInvoiceDate || null;
      const lastBillDate = bill.lastBillDate || null;

      let lastUsageDate = null;
      let lastUsageType = "N/A";

      if (lastInvoiceDate && lastBillDate) {
        if (new Date(lastInvoiceDate) > new Date(lastBillDate)) {
          lastUsageDate = lastInvoiceDate;
          lastUsageType = "Purchase Invoice";
        } else {
          lastUsageDate = lastBillDate;
          lastUsageType = "Sales Bill";
        }
      } else if (lastInvoiceDate) {
        lastUsageDate = lastInvoiceDate;
        lastUsageType = "Purchase Invoice";
      } else if (lastBillDate) {
        lastUsageDate = lastBillDate;
        lastUsageType = "Sales Bill";
      }

      /* -------- BRAND MAPPING (NAME ONLY) -------- */

      const brandNames = Array.isArray(db.brandId)
        ? db.brandId
          .map(id => brandMap[id.toString()])
          .filter(Boolean)
          .join(", ")
        : "N/A";

      /* -------- CSV WRITE -------- */

      csvStream.write({
        "Start Date": hasDateRange
          ? moment(startDate).format("DD-MM-YYYY")
          : moment(db.createdAt).format("DD-MM-YYYY"),
        "End Date": hasDateRange
          ? moment(endDate).format("DD-MM-YYYY")
          : moment().format("DD-MM-YYYY"),
        "Distributor Code": db.dbCode,
        "Distributor Name": db.name,
        "Brands": brandNames,
        "Distributor Onboarding Date": moment(db.createdAt).format(
          "DD-MM-YYYY"
        ),
        "Purchase Invoice Count": totalInvoiceCountAllStatus,

        "Purchase Invoice Value": totalInvoiceValueAllStatus,

        "GRN Count": purchaseInvoiceSelectedRange,
        "GRN Value": purchaseInvoiceValueSelectedRange,
        "Total GRN Count": purchaseInvoiceFromOnboard,
        "Total GRN Value": purchaseInvoiceValueFromOnboard,

        "Sales Bill Count": salesBillSelectedRange,
        "Sales Bill Value": salesBillValueSelectedRange,
        "Total Sales Bill Count": salesBillFromOnboard,
        "Total Sales Bill Value": salesBillValueFromOnboard,
        "Opening Stock": db.openingStock ? "Yes" : "No",
        "Last Usage Date": lastUsageDate
          ? moment(lastUsageDate).format("DD-MM-YYYY")
          : "N/A",
        "Last Usage Type": lastUsageType ? lastUsageType : "N/A",
        "Distributor Status": distributorStatus,
      });
    }

    csvStream.end();
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = { usageReport };
