const asyncHandler = require("express-async-handler");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const csvParser = require("csv-parser");
const Beat = require("../../models/beat.model");
const { mapStatusReverse } = require("../../utils/mapStatus");
const Outlet = require("../../models/outlet.model");
const Employee = require("../../models/employee.model");
const { outletImpCode } = require("../../utils/codeGenerator");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Distributor = require("../../models/distributor.model");

const bulkApproveRejectOutlet = asyncHandler(async (req, res) => {
  try {
    const { csvUrl } = req.body;
    const tempFilePath = path.join(__dirname, "temp.csv");

    // 1. Download the CSV file from the URL
    const response = await axios({
      url: csvUrl,
      method: "GET",
      responseType: "stream",
    });

    // Save the file locally
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    writer.on("finish", async () => {
      const outlets = [];

      // 2. Parse the CSV
      fs.createReadStream(tempFilePath)
        .pipe(csvParser())
        .on("data", (row) => {
          outlets.push(row);
        })
        .on("end", async () => {
          const bulkOperations = [];
          const rejectedOutlets = [];

          // 3. Prepare bulk operations
          for (const outlet of outlets) {
            // Ensure the status field matches the CSV header
            const status = mapStatusReverse(outlet["Approval Status"]);

            const empData = await Employee.findOne({
              empId: outlet["Employee Code"],
            });
            const regionData = await Region.findOne({ _id: empData?.regionId });
            const stateData = await State.findOne({ _id: regionData?.stateId });
            const stateCode = stateData?.slug;
            const distributorCode = outlet["DB Code"];
            const outletCode = await outletImpCode(distributorCode);

            const outletUID = await outletImpCode(stateCode);

            if (status === "Approved") {
              const beatRecord = await Beat.findOne({
                code: outlet["Beat Code"],
              });

              const distributorRecord = await Distributor.findOne({
                dbCode: outlet["DB Code"],
              });

              if (beatRecord) {
                bulkOperations.push({
                  updateOne: {
                    filter: { leadId: outlet["Lead Id"] },
                    update: {
                      $set: {
                        outletCode: outletCode,
                        outletUID: outletUID,
                        beatId: beatRecord._id,
                        distributorId: distributorRecord._id,
                        remarks: null,
                        outletStatus: status,
                        approvedDate: new Date(),
                      },
                    },
                  },
                });
              } else {
                rejectedOutlets.push({
                  _id: outlet["Lead Id"],
                  error: `Invalid beatCode: ${outlet["Beat Code"]}`,
                });
              }
            } else if (status === "Rejected") {
              bulkOperations.push({
                updateOne: {
                  filter: { leadId: outlet["Lead Id"] },
                  update: {
                    $set: {
                      outletStatus: status,
                      remarks: outlet.Remarks || "No remarks provided",
                    },
                  },
                },
              });
            } else {
              rejectedOutlets.push({
                _id: outlet["Lead Id"],
                error: `Unknown status: ${outlet["Approval Status"]}`,
              });
            }
          }

          // 4. Execute bulk operations
          if (bulkOperations.length > 0) {
            try {
              const result = await Outlet.bulkWrite(bulkOperations);
            } catch (err) {
              console.error("Error executing bulk operations:", err.message);
              throw new Error("Failed to execute bulk operations");
            }
          }

          // 5. Clean up the temporary file
          try {
            fs.unlinkSync(tempFilePath);
          } catch (err) {
            console.error("Error deleting temporary file:", err.message);
            throw new Error("Failed to delete temporary file");
          }

          res.status(200).json({
            status: 200,
            message: "Bulk approve/reject outlet done",
            skippedCount: rejectedOutlets.length,
            successCount: bulkOperations.length,
            skippedRows: rejectedOutlets.length > 0 ? rejectedOutlets : null,
          });
        })
        .on("error", (err) => {
          console.error("Error parsing CSV file:", err.message);
          throw new Error("Failed to parse CSV file");
        });
    });

    writer.on("error", (err) => {
      console.error("Error writing CSV file:", err.message);
      throw new Error("Failed to write CSV file");
    });
  } catch (error) {
    console.error("Error in bulkApproveRejectOutlet:", error.message);
    res.status(400).json({ message: error.message || "Something went wrong" });
  }
});

module.exports = {
  bulkApproveRejectOutlet,
};
