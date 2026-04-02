// const asyncHandler = require("express-async-handler");
// const path = require("path");
// const { v4: uuidv4 } = require("uuid");
// const axios = require("axios");
// const csv = require("csv-parser");
// const fs = require("fs");

// const Supplier = require("../../models/supplier.model");
// const Distributor = require("../../models/distributor.model");
// const State = require("../../models/state.model");
// const { generateCode } = require("../../utils/codeGenerator");

// const supplierBulkUpload = asyncHandler(async (req, res) => {
//   const { csvUrl } = req.body;

//   if (!csvUrl) {
//     return res.status(400).json({ message: "CSV URL is required" });
//   }

//   const fileName = `${uuidv4()}.csv`;
//   const filePath = path.join(__dirname, fileName);

//   try {
//     const response = await axios({
//       method: "GET",
//       url: csvUrl,
//       responseType: "stream",
//     });

//     const writer = fs.createWriteStream(filePath);
//     response.data.pipe(writer);

//     writer.on("finish", () => {
//       const results = [];

//       fs.createReadStream(filePath)
//         .pipe(csv())
//         .on("data", (data) => results.push(data))
//         .on("end", async () => {
//           try {
//             const suppliers = [];
//             const skipped = [];

//             for (const row of results) {
//               try {
//                 const distributorCodes = row["Distributors"]
//                   .split(";")
//                   .map((code) => code.trim());

//                 const distributors = await Distributor.find({
//                   name: { $in: distributorCodes },
//                 }).select("_id");

//                 if (distributors.length === 0) {
//                   skipped.push({
//                     row,
//                     reason: `No matching distributors for: ${distributorCodes.join(
//                       ", "
//                     )}`,
//                   });
//                   continue;
//                 }

//                 const state = await State.findOne({
//                   name: row["Supplier State"],
//                 }).select("_id");

//                 if (!state) {
//                   skipped.push({
//                     row,
//                     reason: `Invalid state name: ${row["Supplier State"]}`,
//                   });
//                   continue;
//                 }

//                 const supplierExist = await Supplier.findOne({
//                   supplierCode: row["Supplier Code"],
//                 });

//                 if (supplierExist) {
//                   skipped.push({
//                     row,
//                     reason: `Supplier already exists with supplier code ${row["Supplier Code"]} `,
//                   });
//                   continue;
//                 }

//                 // Validate required fields
//                 const requiredFields = {
//                   supplierCode: row["Supplier Code"],
//                   supplierName: row["Supplier Name"],
//                   supplierType: row["Supplier Type"],
//                   distributorId: distributors.map((d) => d._id),
//                   contactNo: row["Contact No"],
//                   email: row["Email"],
//                 };

//                 const missingFields = Object.entries(requiredFields)
//                   .filter(
//                     ([_, value]) =>
//                       !value || (Array.isArray(value) && value.length === 0)
//                   )
//                   .map(([key]) => key);

//                 if (missingFields.length > 0) {
//                   skipped.push({
//                     row,
//                     reason: `Missing required fields: ${missingFields.join(
//                       ", "
//                     )}`,
//                   });
//                   continue;
//                 }

//                 suppliers.push({
//                   supplierCode: row["Supplier Code"],
//                   supplierName: row["Supplier Name"],
//                   supplierType: row["Supplier Type"],
//                   distributorId: distributors.map((d) => d._id),
//                   stateId: state._id,
//                   address: row["Address"] || "",
//                   gstNo: row["GST No"] || "",
//                   contactNo: row["Contact No"],
//                   email: row["Email"],
//                   pinCode: row["Pincode"] || "",
//                   status: row["Status"]?.toLowerCase() || "active",
//                 });
//               } catch (innerErr) {
//                 skipped.push({ row, reason: innerErr.message });
//               }
//             }

//             if (suppliers.length > 0) {
//               await Supplier.insertMany(suppliers, { ordered: false });
//             }

//             fs.unlinkSync(filePath);

//             res.status(201).json({
//               message: "Bulk upload complete",
//               uploadedCount: suppliers.length,
//               skippedCount: skipped.length,
//               skipped,
//             });
//           } catch (err) {
//             fs.unlinkSync(filePath);
//             res.status(500).json({ message: err.message });
//           }
//         });
//     });

//     writer.on("error", (err) => {
//       throw new Error(`Failed to write file: ${err.message}`);
//     });
//   } catch (error) {
//     if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
//     res.status(500).json({ message: error.message });
//   }
// });

// module.exports = {
//   supplierBulkUpload,
// };
//////////////////////////////////////////////////

const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const csv = require("csv-parser");
const fs = require("fs");

const Supplier = require("../../models/supplier.model");
const Distributor = require("../../models/distributor.model");
const State = require("../../models/state.model");

const supplierBulkUpload = asyncHandler(async (req, res) => {
  const { csvUrl } = req.body;

  if (!csvUrl) {
    return res.status(400).json({ message: "CSV URL is required" });
  }

  const fileName = `${uuidv4()}.csv`;
  const filePath = path.join(__dirname, fileName);

  try {
    const response = await axios({
      method: "GET",
      url: csvUrl,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", () => {
      const results = [];

      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", async () => {
          try {
            const suppliers = [];
            const skipped = [];

            for (const row of results) {
              try {
                // Optional Distributors
                let distributorIds = [];
                if (row["Distributors"]) {
                  const distributorNames = row["Distributors"]
                    .split(";")
                    .map((code) => code.trim())
                    .filter(Boolean);

                  if (distributorNames.length > 0) {
                    const distributors = await Distributor.find({
                      name: { $in: distributorNames },
                    }).select("_id");

                    distributorIds = distributors.map((d) => d._id);
                  }
                }

                // Optional State
                let state = null;
                if (row["Supplier State"]) {
                  state = await State.findOne({
                    name: row["Supplier State"],
                  }).select("_id");
                }

                const supplierExist = await Supplier.findOne({
                  supplierCode: row["Supplier Code"],
                });

                if (supplierExist) {
                  skipped.push({
                    row,
                    reason: `Supplier already exists with supplier code ${row["Supplier Code"]}`,
                  });
                  continue;
                }

                // Validate required fields
                const requiredFields = {
                  supplierCode: row["Supplier Code"],
                  supplierName: row["Supplier Name"],
                  supplierType: row["Supplier Type"],
                };

                const missingFields = Object.entries(requiredFields)
                  .filter(([_, value]) => !value)
                  .map(([key]) => key);

                if (missingFields.length > 0) {
                  skipped.push({
                    row,
                    reason: `Missing required fields: ${missingFields.join(
                      ", "
                    )}`,
                  });
                  continue;
                }

                suppliers.push({
                  supplierCode: row["Supplier Code"],
                  supplierName: row["Supplier Name"],
                  supplierType: row["Supplier Type"],
                  coCode: row["CoCd"],
                  distributorId: distributorIds,
                  ...(state ? { stateId: state._id } : {}),
                  address: row["Address"] || "",
                  city: row["City"] || "",
                  gstNo: row["GST No"] || "",
                  contactNo: row["Contact No"],
                  email: row["Email"],
                  pinCode: row["Pincode"] || "",
                  status: row["Status"]?.toLowerCase() || "active",
                });
              } catch (innerErr) {
                skipped.push({ row, reason: innerErr.message });
              }
            }

            if (suppliers.length > 0) {
              await Supplier.insertMany(suppliers, { ordered: false });
            }

            fs.unlinkSync(filePath);

            res.status(201).json({
              message: "Bulk upload complete",
              uploadedCount: suppliers.length,
              skippedCount: skipped.length,
              skipped,
            });
          } catch (err) {
            fs.unlinkSync(filePath);
            res.status(500).json({ message: err.message });
          }
        });
    });

    writer.on("error", (err) => {
      throw new Error(`Failed to write file: ${err.message}`);
    });
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ message: error.message });
  }
});

module.exports = {
  supplierBulkUpload,
};
