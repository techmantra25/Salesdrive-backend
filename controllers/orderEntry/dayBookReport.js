const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");

const dayBookReport = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user.id;

    const {
      fromDate,
      toDate,
      reportType = "view", // view | download
    } = req.query;

    // ------------------------------------------------
    // VALIDATION
    // ------------------------------------------------

    if (!fromDate || !toDate) {
      return res.status(400).json({
        status: 400,
        message: "fromDate and toDate are required",
      });
    }

    // ------------------------------------------------
    // DATE FILTER
    // FIXED TIMEZONE ISSUE
    // ------------------------------------------------

    const startDate = new Date(
      `${fromDate}T00:00:00`
    );

    const endDate = new Date(
      `${toDate}T23:59:59.999`
    );

    // ------------------------------------------------
    // FETCH ORDER ENTRIES
    // ------------------------------------------------

    const orderEntries = await OrderEntry.find({
      distributorId,

      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    })
      .populate([
        {
          path: "retailerId",
          model: "OutletApproved",
          select: "outletName outletCode",
        },
      ])
      .sort({ createdAt: 1 });

    // ------------------------------------------------
    // REMOVE DUPLICATE ORDER FLOWS
    // ------------------------------------------------

    const filteredOrders = orderEntries.filter(
      (item) => {
        // ONLY CHECK PENDING
        if (item.status === "Pending") {
          // CHECK COMPLETED VERSION
          const hasCompletedVersion =
            orderEntries.some((checkItem) => {
              return (
                checkItem.status ===
                  "Completed_Billed" &&
                checkItem.orderNo.replace(
                  "DBO",
                  ""
                ) ===
                  item.orderNo.replace(
                    "DBO",
                    ""
                  )
              );
            });

          // REMOVE PENDING
          if (hasCompletedVersion) {
            return false;
          }
        }

        return true;
      }
    );

    // ------------------------------------------------
    // FORMAT REPORT DATA
    // ------------------------------------------------

    let grandBasicAmount = 0;

    let grandInclGSTAmount = 0;

    const reportData = filteredOrders.map(
      (item) => {
        const basicAmount = Number(
          item.taxableAmount || 0
        );

        const inclGSTAmount = Number(
          item.netAmount || 0
        );

        grandBasicAmount += basicAmount;

        grandInclGSTAmount += inclGSTAmount;

        return {
          orderNo: item.orderNo,

          status: item.status,

          date: new Date(
            item.createdAt
          ).toLocaleDateString("en-GB"),

          voucherType: item.orderType || "",

          partyName:
            item?.retailerId?.outletName ||
            item?.retailerId?.outletCode ||
            "N/A",

          basicAmount,

          inclGSTAmount,
        };
      }
    );

    // ------------------------------------------------
    // DAY WISE TOTALS
    // ------------------------------------------------

    const dayWiseTotals = {};

    reportData.forEach((item) => {
      if (!dayWiseTotals[item.date]) {
        dayWiseTotals[item.date] = {
          basicAmount: 0,
          inclGSTAmount: 0,
        };
      }

      dayWiseTotals[item.date].basicAmount +=
        item.basicAmount;

      dayWiseTotals[item.date].inclGSTAmount +=
        item.inclGSTAmount;
    });

    // ------------------------------------------------
    // CSV DOWNLOAD
    // ------------------------------------------------

    if (reportType === "download") {
      let csv =
        "Order No,Date,Voucher Type,Party Name,Status,Basic Amount,Incl GST Amount\n";

      // ------------------------------------------------
      // REPORT ROWS
      // ------------------------------------------------

      reportData.forEach((item) => {
        csv += `${item.orderNo},${item.date},${item.voucherType},${item.partyName},${item.status},${Number(
          item.basicAmount || 0
        ).toFixed(2)},${Number(
          item.inclGSTAmount || 0
        ).toFixed(2)}\n`;
      });

      // ------------------------------------------------
      // DAY WISE TOTALS
      // ------------------------------------------------

      csv += `\n`;

      csv += `DAY WISE TOTALS\n`;

     
      csv += `Date,,,,,Basic Amount,Incl GST Amount\n`;

      Object.keys(dayWiseTotals).forEach(
        (date) => {
         csv += `${date},,,,,${Number(
            dayWiseTotals[date]
              .basicAmount || 0
          ).toFixed(2)},${Number(
            dayWiseTotals[date]
              .inclGSTAmount || 0
          ).toFixed(2)}\n`;
        }
      );

      // ------------------------------------------------
      // GRAND TOTAL
      // ------------------------------------------------

      csv += `\n`;

      csv += `GRAND TOTAL SUMMARY\n`;

      csv += `,,,,,Basic Amount,Incl GST Amount\n`;

      csv += `TOTAL,,,,,${Number(
        grandBasicAmount || 0
      ).toFixed(2)},${Number(
        grandInclGSTAmount || 0
      ).toFixed(2)}\n`;

      // ------------------------------------------------
      // RESPONSE
      // ------------------------------------------------

      res.header("Content-Type", "text/csv");

      res.attachment(
        `day-book-report-${fromDate}-to-${toDate}.csv`
      );

      return res.send(csv);
    }

    // ------------------------------------------------
    // VIEW RESPONSE
    // ------------------------------------------------

    return res.status(200).json({
      status: 200,

      message:
        "Day book report fetched successfully",

      filters: {
        fromDate,
        toDate,
      },

      data: reportData,

      dayWiseTotals,

      grandTotals: {
        basicAmount: grandBasicAmount,
        inclGSTAmount: grandInclGSTAmount,
      },

      totalRows: reportData.length,
    });
  } catch (error) {
    console.log(
      "DAY BOOK REPORT ERROR:",
      error
    );

    return res.status(500).json({
      status: 500,
      message:
        error.message || "Something went wrong",
    });
  }
});

module.exports = {
  dayBookReport,
};