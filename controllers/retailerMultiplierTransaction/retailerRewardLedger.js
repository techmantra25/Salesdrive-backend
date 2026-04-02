const asyncHandler = require("express-async-handler");
const moment = require("moment-timezone");
const axios = require("axios");
const { format } = require("fast-csv");
const OutletApproved = require("../../models/outletApproved.model");
const {
  RBP_POINT_RETAILER_LEDGER_API,
} = require("../../config/retailerApp.config");
const Bill = require("../../models/bill.model");
const Distributor = require("../../models/distributor.model");
const {writeLog, getLogFilePath} = require("../../writeLog");

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

const retailerRewardLedger = asyncHandler(async (req, res) => {
  try {
    const { retailerId, retailerIds, startDate, endDate } = req.query;
    const MAX_BATCH_SIZE = 1000;
    if ((!retailerId && !retailerIds) || !startDate || !endDate) {
      res.status(400);
      throw new Error(
        "Missing required fields: retailerId, startDate, endDate"
      );
    }

    let retailerList = [];
    if (retailerIds === "all") {
      // Get all retailers from OutletApproved
      const outletsApproved = await OutletApproved.find({}).sort({ _id: -1 });
      // take only the IDs into retailerList
      retailerList = outletsApproved.map((outlet) => outlet._id.toString());
      // console.log('retailerList', retailerList);
      // return false;

    } else if (retailerIds) {
      // Specific list of retailerIds provided (comma separated)
      retailerList = Array.isArray(retailerIds)
        ? retailerIds
        : retailerIds.split(",").map((id) => id.trim());
    } else if (retailerId) {
      // Single retailerId provided
      retailerList = [retailerId];
    }

    // find out the distributor who have billed the most to this retailer in this time period
    // Use moment-timezone to set start and end in Asia/Kolkata timezone
    const start = moment.tz(startDate, "Asia/Kolkata").startOf("day").toDate();
    const end = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();

    if (start > end) {
      throw new Error(
        "Start date cannot be after end date"
      );
    }

    // get retailers data
    const startOfDay = moment
      .tz(startDate, "Asia/Kolkata")
      .startOf("day")
      .toDate();
    const endOfDay = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();
    // add a day in the end date
    endOfDay.setDate(endOfDay.getDate());

    if (startOfDay > endOfDay) {
      res.status(400);
      throw new Error("Start date cannot be after end date");
    }

    const formattedStartDate = moment(startOfDay).format("YYYY-MM-DD");
    const formattedEndDate = moment(endOfDay).format("YYYY-MM-DD");
    const selectedOutletApproved = await OutletApproved.find({ _id : { $in: retailerList} }).sort({ _id: -1 });
      // take only the IDs into retailerList
    const retailerUIDList = selectedOutletApproved.map((outlet) => outlet.outletUID.toString());
    const retailerChunks = chunkArray(retailerUIDList, MAX_BATCH_SIZE); // custom chunk function or lodash.chunk
    console.log('Total Retailer Chunks:', retailerChunks.length);

    let retailerLedgerAllData = []; // initialize properly

    try {
        // const allPromises = retailerChunks.map(async (retailerChunk) => {
        //   try {
        //     console.log('LEDGER_API Start Time :', new Date().toLocaleTimeString());

        //     const response = await axios.post(RBP_POINT_RETAILER_LEDGER_API, {
        //       retailer_uid: retailerChunk, // array of UIDs
        //       startDate: formattedStartDate,
        //       endDate: formattedEndDate,
        //     });

        //     console.log('LEDGER_API End Time :', new Date().toLocaleTimeString());

        //     const batchData = response?.data?.data || [];
        //     writeLog(`RETAILER_LEDGER_API: ${JSON.stringify({
        //       retailer_uid: retailerChunk,
        //       startDate: formattedStartDate,
        //       endDate: formattedEndDate,
        //       batchData: batchData.length,
        //     })}`);
        //     console.log(`BatchData size: ${batchData.length}`);

        //     return batchData;
        //   } catch (err) {
        //     writeLog(`RETAILER_LEDGER_API_ERROR: ${JSON.stringify({
        //       retailer_uid: retailerChunk,
        //       startDate: formattedStartDate,
        //       endDate: formattedEndDate,
        //       error: err.message,
        //     })}`);
        //     console.error(
        //       `Error fetching batch (size: ${retailerChunk.length}):`,
        //       err.message
        //     );
        //     return []; // ensures Promise.all continues
        //   }
        // });
        //   // Wait for all batches to finish
        //   const allResults = await Promise.all(allPromises);

        //   // Combine all batch results
        //   retailerLedgerAllData = allResults.flat();

        // improve api call
        console.time("⏱ TOTAL_RBP_POINT_RETAILER_LEDGER_API");
        writeLog(`TOTAL_RBP_POINT_RETAILER_LEDGER_API_START: ${new Date().toLocaleTimeString()}`);
        for (const retailerChunk of retailerChunks) {
          try {
            const label = `📤 LEDGER_API_${retailerChunk.length}_${new Date().toLocaleTimeString()}`;
            console.time(label);
            // console.log(RBP_POINT_RETAILER_LEDGER_API, {
            //   retailer_uid: retailerChunk,
            //   startDate: formattedStartDate,
            //   endDate: formattedEndDate,
            // });
            writeLog(`CHUNK_RETAILER_LEDGER_API_START`);
            const response = await axios.post(RBP_POINT_RETAILER_LEDGER_API, {
              retailer_uid: retailerChunk,
              startDate: formattedStartDate,
              endDate: formattedEndDate,
            });
            console.timeEnd(label);
            
            const batchData = response?.data?.data || [];
            writeLog(`CHUNK_RETAILER_LEDGER_API_END: ${JSON.stringify({
              retailer_uid: retailerChunk.length,
              startDate: formattedStartDate,
              endDate: formattedEndDate,
              batchData: batchData.length,
            })}`);
            console.log(`BatchData size: ${batchData.length}`);

            retailerLedgerAllData.push(...batchData); // merge results
          } catch (err) {
            writeLog(`RETAILER_LEDGER_API_ERROR: ${JSON.stringify({
              retailer_uid: retailerChunk,
              startDate: formattedStartDate,
              endDate: formattedEndDate,
              error: err.message,
            })}`);
            console.error(
              `Error fetching batch (size: ${retailerChunk.length}):`,
              err.message
            );
            // continue without breaking
          }

          // small delay to avoid throttling
          await new Promise((r) => setTimeout(r, 200)); // 200ms delay
        }
        writeLog(`TOTAL_RBP_POINT_RETAILER_LEDGER_API_END: ${new Date().toLocaleTimeString()}`);
        console.timeEnd("⏱ TOTAL_RBP_POINT_RETAILER_LEDGER_API");
        // improve api call end  
        console.log(`Total fetched records: ${retailerLedgerAllData.length}`);
        } catch (err) {
          console.error('Unexpected error while fetching retailer ledger data:', err.message);
      }

      const groupedRetailerLedger = retailerLedgerAllData.reduce((acc, entry) => {
      const retailerCode = entry["Retailer code"];
      if (!acc[retailerCode]) {
        acc[retailerCode] = [];
      }
      acc[retailerCode].push(entry);
      return acc;
    }, {});
    // console.log(`groupedRetailerLedger: ${JSON.stringify(groupedRetailerLedger)}`);
    // get retailers data end
    const CSV_HEADER = [
      "Date",
      "Retailer code",
      "Retailer name",
      "Retailer state",
      "Retailer city",
      "DB Name",
      "DB Code",
      "Opening balance",
      "Opening Point Credit",
      "Sales Point Credit",
      "Multiplier Point Credit",
      "Redemption Cancellation Point Credit",
      "Manual Adjustment Point Credit",
      "Sales Return Point Debit",
      "Sales Return Multiplier Point Debit",
      "Gift Redemption Point Debit",
      "Manual Adjustment Point Debit",
      "Day Total Points",
      "Closing balance",
    ];

    // Generate CSV file name
    const fileName = `retailer-reward-ledger-${moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD-HH-mm-ss")}.csv`;

    // Set response headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Create CSV stream
    const csvStream = format({ headers: CSV_HEADER });
    csvStream.pipe(res);
    writeLog(`RETAILER_REWARD_LEDGER_CSV_START: ${new Date().toLocaleTimeString()}`);
    for (const rId of retailerList) {
      const retailer = await OutletApproved.findById(rId).populate("stateId", "");
      if (!retailer) continue; // skip if not found

      const retailerUID = retailer?.outletUID;
      const retailerCode = retailer?.outletCode;
      const retailerName = retailer?.outletName || "";
      const state = retailer?.stateId?.name || "";
      const city = retailer?.city || "";

      const billingData = await Bill.find({
        retailerId: rId,
        createdAt: {
          $gte: start,
          $lte: end,
        },
      });

    const distributorBillingMap = {};
    billingData.forEach((bill) => {
      const distributorId = bill.distributorId.toString();
      const billAmount = parseFloat(bill.netAmount) || 0;
      if (distributorBillingMap[distributorId]) {
        distributorBillingMap[distributorId] += billAmount;
      } else {
        distributorBillingMap[distributorId] = billAmount;
      }
    });

    let topDistributorId = null;
    let maxBilledAmount = 0;
    for (const [distributorId, totalAmount] of Object.entries(
      distributorBillingMap
    )) {
      if (totalAmount > maxBilledAmount) {
        maxBilledAmount = totalAmount;
        topDistributorId = distributorId;
      }
    }

    let DBName = "";
    let DBCode = "";
    if (topDistributorId) {
      const distributorInfo = await Distributor.findById(topDistributorId);
      DBName = distributorInfo?.name || "";
      DBCode = distributorInfo?.dbCode || "";
    }

    // const startOfDay = moment
    //   .tz(startDate, "Asia/Kolkata")
    //   .startOf("day")
    //   .toDate();
    // const endOfDay = moment.tz(endDate, "Asia/Kolkata").endOf("day").toDate();
    // // add a day in the end date
    // endOfDay.setDate(endOfDay.getDate() + 1);

    // if (startOfDay > endOfDay) {
    //   res.status(400);
    //   throw new Error("Start date cannot be after end date");
    // }

    // const formattedStartDate = moment(startOfDay).format("YYYY-MM-DD");
    // const formattedEndDate = moment(endOfDay).format("YYYY-MM-DD");

    // // Fetch the retailer's reward ledger data
    // const apiResponse = await axios.post(RBP_POINT_RETAILER_LEDGER_API, {
    //   retailer_uid: retailerUID,
    //   startDate: formattedStartDate,
    //   endDate: formattedEndDate,
    // });

    // const data = apiResponse?.data?.data || [];
    const data = groupedRetailerLedger[retailerCode] || [];
    // if (!data.length){
    //   console.log(`Skipping retailer ${retailerCode} — no data exists to date range`); 
    //   continue; // skip if no ledger
    // }

    // Check if all Opening & Closing balances are zero
    const hasValidBalance = data.some((row) => {
      const opening = Number(row["Opening balance"]) || 0;
      const closing = Number(row["Closing balance"]) || 0;
      return opening !== 0 || closing !== 0;
    });

    // if (!hasValidBalance) {
    //   console.log(`Skipping retailer ${retailerCode} — all balances are 0`);
    //   continue; // skip retailer completely
    // }

    // if (data.length === 0) {
    //   res.status(404);
    //   throw new Error("No reward ledger data found for the given criteria");
    // }
    // Write each data row to CSV
    const filteredData = data.slice(0); // skip first records bcz it's a backdate
    data.forEach((row) => {
      // Calculate Day Total Points (Credits - Debits)
      const totalCredits =
        (row["Sales Point Credit"] || 0) +
        (row["Multiplier Point Credit"] || 0) +
        (row["Redemption Cancellation Point Credit"] || 0) +
        (row["Manual Adjustment Point Credit"] || 0);

      const totalDebits =
        (row["Sales Return Point Debit"] || 0) +
        (row["Sales Return Multiplier Point Debit"] || 0) +
        (row["Gift Redemption Point Debit"] || 0) +
        (row["Manual Adjustment Point Debit"] || 0);

      const dayTotalPoints = totalCredits - totalDebits;
      csvStream.write({
        Date: row.Date,
        "Retailer code": row["Retailer code"],
        "Retailer name": row["Retailer name"],
        "Retailer state": row["Retailer state"],
        "Retailer city": row["Retailer city"],
        "DB Code": DBCode,
        "DB Name": DBName,
        "Opening balance": row["Opening balance"],
        "Opening Point Credit" : row["Opening Stcok Point Credit"],
        "Sales Point Credit": row["Sales Point Credit"],
        "Multiplier Point Credit": row["Multiplier Point Credit"],
        "Redemption Cancellation Point Credit":
          row["Redemption Cancellation Point Credit"],
        "Manual Adjustment Point Credit": row["Manual Adjustment Point Credit"],
        "Sales Return Point Debit": row["Sales Return Point Debit"],
        "Sales Return Multiplier Point Debit":
          row["Sales Return Multiplier Point Debit"],
        "Gift Redemption Point Debit": row["Gift Redemption Point Debit"],
        "Manual Adjustment Point Debit": row["Manual Adjustment Point Debit"],
        "Day Total Points": dayTotalPoints,
        "Closing balance": row["Closing balance"],
      });
    });
    }
    // End the CSV stream
    csvStream.end();
    writeLog(`RETAILER_REWARD_LEDGER_CSV_END: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error("Retailer Reward Ledger Error:", {
      error: error.message,
      stack: error.stack,
      retailerId: req.query.retailerId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      timestamp: new Date().toISOString(),
    });

    // Styled error HTML
    const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Retailer Reward Ledger Error</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
              color: #333;
            }
            .error-container {
              max-width: 600px;
              margin: 50px auto;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              overflow: hidden;
            }
            .error-header {
              background: #d32f2f;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .error-header h1 {
              margin: 0;
              font-size: 24px;
            }
            .error-content {
              padding: 30px;
            }
            .error-details {
              background: #f8f9fa;
              border-left: 4px solid #d32f2f;
              padding: 15px;
              margin: 20px 0;
              border-radius: 0 4px 4px 0;
            }
            .error-details p {
              margin: 8px 0;
            }
            .error-details strong {
              color: #d32f2f;
            }
            .retry-section {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
            }
            .retry-button {
              display: inline-block;
              background: #1976d2;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 4px;
              font-weight: 500;
              transition: background 0.3s;
            }
            .retry-button:hover {
              background: #1565c0;
            }
            .support-info {
              margin-top: 20px;
              font-size: 14px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <div class="error-header">
              <h1>⚠️ Retailer Reward Ledger Generation Failed</h1>
            </div>
            <div class="error-content">
              <p>We encountered an error while generating the retailer reward ledger. Please check your parameters and try again.</p>
              
              <div class="error-details">
                <p><strong>Error Type:</strong> ${
                  error.name || "Ledger Generation Error"
                }</p>
                <p><strong>Message:</strong> ${error.message}</p>
                <p><strong>Retailer ID:</strong> ${
                  req.query.retailerId || "N/A"
                }</p>
                <p><strong>Start Date:</strong> ${
                  req.query.startDate || "N/A"
                }</p>
                <p><strong>End Date:</strong> ${req.query.endDate || "N/A"}</p>
                <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
              </div>
              
              <div class="retry-section">
                <a href="javascript:location.reload()" class="retry-button">🔄 Try Again</a>
                
                <div class="support-info">
                  <p>If this error continues, please contact technical support with the error details above.</p>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.status(500).send(errorHtml);
  }
});

module.exports = { retailerRewardLedger };
