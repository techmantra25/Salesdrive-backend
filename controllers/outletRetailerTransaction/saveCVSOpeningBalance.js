const asyncHandler = require("express-async-handler");
const csv = require("csv-parser");
const axios = require("axios");

const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");
const OutletApproved = require("../../models/outletApproved.model");
const { retailerOutletTransactionCode } = require("../../utils/codeGenerator");

exports.bulkOpeningBalanceUpload = asyncHandler(async (req, res) => {
  const fileUrl = req.body.file;

  if (!fileUrl) {
    return res.status(400).json({
      success: false,
      message: "CSV file URL is required",
    });
  }

  const fileMime = fileUrl.match(/\.([^.?]+)(?:\?|$)/)?.[1]?.toLowerCase();
  if (fileMime !== "csv") {
    return res.status(400).json({
      success: false,
      message: "Only CSV file is allowed",
    });
  }

  const successList = [];
  const skippedList = [];
  const rows = [];

  // 🔽 Download CSV
  const response = await axios({
    method: "get",
    url: fileUrl,
    responseType: "stream",
  });

  // 🔽 Parse CSV
  await new Promise((resolve, reject) => {
    response.data
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  // 🔽 Process rows
  for (const row of rows) {
    const retailerUID = row["RetailerUID"]?.trim();
    const retailerName = row["RetailerName"]?.trim();
    const mobileNo = row["Mobile No"]?.trim();
    const openingPoint = Number(row["Opening Balance"]);



    const transactionDateRaw = row["Transaction Date"]?.trim();
    const transactionDate = transactionDateRaw
      ? new Date(`${transactionDateRaw}T00:00:00.000Z`)
      : new Date();

    let reason = "";

    console.log(transactionDate,'transactionDate');

    try {
      // ❌ Validation
      if (!retailerUID && !retailerName && !mobileNo) {
        reason = "Retailer identification missing";
        throw new Error(reason);
      }

      if (!openingPoint || openingPoint <= 0) {
        reason = "Invalid opening balance";
        throw new Error(reason);
      }

      if (isNaN(transactionDate.getTime())) {
        reason = "Invalid transaction date";
        throw new Error(reason);
      }

      // 🔍 Find retailer
      const retailer = await OutletApproved.findOne({
        $and: [
          retailerUID ? { outletUID: retailerUID } : {},
        //   retailerName ? { outletName: retailerName } : {},
        //   mobileNo ? { mobile1: mobileNo } : {},
        ],
        status: true,
      });

      if (!retailer) {
        reason = "Retailer not found";
        throw new Error(reason);
      }

      if (retailer.isFirstOpeningPoint === true) {
        reason = "Opening balance already added";
        throw new Error(reason);
      }

      // 🔍 Last transaction
      const lastTransaction = await RetailerOutletTransaction.findOne({
        retailerId: retailer._id,
        status: "Success",
      }).sort({ createdAt: -1 });

      const previousBalance = lastTransaction
        ? lastTransaction.balance
        : retailer.currentPointBalance || 0;

      const newBalance = previousBalance + openingPoint;

      // ✅ Create transaction with CSV date
      await RetailerOutletTransaction.create({
        retailerId: retailer._id,
        transactionId: await retailerOutletTransactionCode("ROT"),
        transactionType: "credit",
        transactionFor: "Opening Points",
        point: openingPoint,
        balance: newBalance,
        distributorId: retailer.distributorId,
        status: "Success",
        remark: `Opening Point for ${retailer.outletUID}`,

        //  CSV timestamp
        createdAt: transactionDate,
        updatedAt: transactionDate,
      });

      // ✅ Update retailer balance
      await OutletApproved.updateOne(
        { _id: retailer._id },
        {
          $set: {
            isFirstOpeningPoint: true,
            currentPointBalance: newBalance,
          },
        }
      );

      successList.push({
        retailerUID: retailer.outletUID,
        retailerName: retailer.outletName,
        creditedPoint: openingPoint,
        previousBalance,
        currentBalance: newBalance,
      });
    } catch (error) {
      skippedList.push({
        retailerUID: retailerUID || retailerName || mobileNo,
        reason: reason || error.message,
      });
    }
  }

  // ✅ Final response
  res.status(200).json({
    success: true,
    message: "Bulk opening balance upload completed",
    summary: {
      totalRows: rows.length,
      successCount: successList.length,
      skippedCount: skippedList.length,
    },
    skippedData: skippedList,
  });
});
