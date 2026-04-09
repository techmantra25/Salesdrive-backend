// const asyncHandler = require("express-async-handler");
// const path = require("path");
// const { v4: uuidv4 } = require("uuid");
// const axios = require("axios");
// const csv = require("csv-parser");
// const fs = require("fs");
// const OutletApproved = require("../../models/outletApproved.model");
// const { outletImpCode } = require("../../utils/codeGenerator");
// const Distributor = require("../../models/distributor.model");
// const Region = require("../../models/region.model");
// const Brand = require("../../models/brand.model");
// const Beat = require("../../models/beat.model");

// const outletApprovedBulk = asyncHandler(async (req, res) => {
//   try {
//     const { csvUrl } = req.body;

//     if (!csvUrl) {
//       return res.status(400).json({ message: "CSV URL is required" });
//     }

//     // Generate a unique filename for the downloaded CSV
//     const fileName = `${uuidv4()}.csv`;
//     const filePath = path.join(__dirname, fileName);

//     // Download the file from the URL
//     const response = await axios({
//       method: "GET",
//       url: csvUrl,
//       responseType: "stream",
//     });

//     // Save the file locally
//     const writer = fs.createWriteStream(filePath);
//     response.data.pipe(writer);

//     writer.on("finish", async () => {
//       const results = [];

//       // Read and parse the downloaded CSV file
//       fs.createReadStream(filePath)
//         .pipe(csv())
//         .on("data", (data) => results.push(data))
//         .on("end", async () => {
//           try {
//             const outlets = await Promise.all(
//               results.map(async (row) => {
//                 // Find distributor by DB Code
//                 const distributor = await Distributor.findOne({
//                   dbCode: row["DB Code"],
//                 })
//                   .populate("stateId", "code slug") // Corrected populate usage
//                   .select("zoneId regionId stateId");

//                 if (!distributor) {
//                   throw new Error(
//                     `Distributor with DB Code ${row["DB Code"]} not found`
//                   );
//                 }

//                 // Find the region and populate the zone
//                 const regionData = await Region.findOne({
//                   _id: distributor.regionId,
//                 }).populate("zoneId", "code"); // Corrected populate usage

//                 // Find beat by Beat Code
//                 const beat = await Beat.findOne({
//                   code: row["Beat Code"],
//                 }).select("_id");

//                 if (!beat) {
//                   throw new Error(
//                     `Beat with code ${row["Beat Code"]} not found`
//                   );
//                 }

//                 // Check if "Selling Brand" exists and is not empty
//                 let sellingBrands = [];
//                 if (row["Selling Brands"]) {
//                   sellingBrands = await Brand.find({
//                     code: { $in: row["Selling Brands"].split(";") },
//                   }).select("_id");
//                 }

//                 // Generate outletCode and outletUID
//                 const outletCode = await outletImpCode(row["DB Code"]);
//                 const passwordData = "RT@" + outletCode;
//                 const outletUID = await outletImpCode(
//                   distributor?.stateId?.slug
//                 );

//                 return {
//                   createdBy: req.user._id,
//                   createdBy_type: "User",
//                   zoneId: regionData?.zoneId?._id,
//                   stateId: distributor?.stateId?._id,
//                   regionId: distributor?.regionId,
//                   distributorId: distributor?._id,
//                   outletCode: outletCode,
//                   password: passwordData,
//                   outletUID: outletUID,
//                   outletName: row["Outlet Name"],
//                   ownerName: row["Owner Name"],
//                   pin: row["Pin Code"],
//                   district: row["District"],
//                   mobile1: row["Mobile No"],
//                   mobile2: row["Alternate Mobile No"],
//                   whatsappNumber: row["WhatsApp No"],
//                   teleCallingSlot: row["Tele Calling Slot"],
//                   preferredLanguage: row["Preferred Language"],
//                   teleCallDay: row["Tele Call Day"],
//                   beatId: beat._id,
//                   address1: row["Address 1"],
//                   address2: row["Address 2"],
//                   marketCenter: row["Market Center"],
//                   city: row["City"],
//                   aadharNumber: row["Aadhar Number"],
//                   panNumber: row["PAN Number"],
//                   gstin: row["GST Number"],
//                   poiFrontImage: row["POI Front Image"],
//                   poiBackImage: row["POI Back Image"],
//                   outletImage: row["Outlet Image"],
//                   poaFrontImage: row["POA Front Image"],
//                   poaBackImage: row["POA Back Image"],
//                   enrollmentForm: row["Enrollment Form"],
//                   location: row["Landmark"],
//                   OutletsubBrands: row["Outlet subBrand"],
//                   categoryOfOutlet: row["Category Of Outlet"],
//                   productCategory: row["Product Category"],
//                   sellingBrands: sellingBrands.map((brand) => brand._id),
//                   competitorBrands: row["Competitor Brands"],
//                   existingRetailer: row["Existing Retailer"],
//                   status: true,
//                   outletSource: "Admin",
//                 };
//               })
//             );

//             // Insert or update the outlets in bulk
//             await OutletApproved.create(outlets, { ordered: false });

//             // Delete the local file after processing
//             fs.unlinkSync(filePath);

//             res.status(201).json({ message: "Outlets uploaded successfully" });
//           } catch (err) {
//             fs.unlinkSync(filePath); // Clean up the file in case of error
//             res.status(500).json({ message: err.message });
//           }
//         });
//     });

//     writer.on("error", (err) => {
//       throw new Error(`Failed to write the file: ${err.message}`);
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// module.exports = {
//   outletApprovedBulk,
// };

///////////////////////////////////////////////////// NEW CODE ////////////////////////////////////////////

const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const csv = require("csv-parser");
const fs = require("fs");
const OutletApproved = require("../../models/outletApproved.model");
const Distributor = require("../../models/distributor.model");
const Region = require("../../models/region.model");
const Brand = require("../../models/brand.model");
const Beat = require("../../models/beat.model");
const bcrypt = require("bcryptjs");
const { outletImpCode } = require("../../utils/codeGenerator");
const { exists } = require("../../models/purchaseOrder.model");

const outletApprovedBulk = asyncHandler(async (req, res) => {
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

    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    const results = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    const outlets = await Promise.all(
      results.map(async (row) => {
        const distributor = await Distributor.findOne({
          dbCode: row["DB Code"],
        })
          .populate("stateId", "code slug")
          .select("zoneId regionId stateId");

        if (!distributor) {
          throw new Error(
            `Distributor with DB Code ${row["DB Code"]} not found`
          );
        }

        const regionData = await Region.findById(distributor.regionId).populate(
          "zoneId",
          "code"
        );

        const beat = await Beat.findOne({ code: row["Beat Code"] }).select(
          "_id"
        );

        if (!beat) {
          throw new Error(`Beat with code ${row["Beat Code"]} not found`);
        }

        let sellingBrands = [];
        if (row["Selling Brands"]) {
          sellingBrands = await Brand.find({
            code: { $in: row["Selling Brands"].split(";") },
          }).select("_id");
        }

        const outletCode = await outletImpCode(row["DB Code"]);
        const outletUID = await outletImpCode(distributor?.stateId?.slug);
        const plainPassword = "RT@" + outletCode;
        // const hashedPassword = await bcrypt.hash(plainPassword, 10);

        existingOutlet = await OutletApproved.findOne({
          outletCode: outletCode,
        });

        if (existingOutlet) {
          return res.status(400).json({
            status: 400,
            message: "Outlet code already exists",
          });
        }

        return {
          createdBy: req.user._id,
          createdBy_type: "User",
          zoneId: regionData?.zoneId?._id,
          stateId: distributor?.stateId?._id,
          regionId: distributor?.regionId,
          distributorId: distributor?._id,
          outletCode,
          outletUID,
          password: plainPassword,
          outletName: row["Outlet Name"],
          ownerName: row["Owner Name"],
          pin: row["Pin Code"],
          district: row["District"],
          mobile1: row["Mobile No"],
          mobile2: row["Alternate Mobile No"],
          whatsappNumber: row["WhatsApp No"],
          teleCallingSlot: row["Tele Calling Slot"]
            ? [row["Tele Calling Slot"]]
            : undefined,
          preferredLanguage: row["Preferred Language"],
          teleCallDay: row["Tele Call Day"],
          beatId: beat._id,
          address1: row["Address 1"],
          address2: row["Address 2"],
          marketCenter: row["Market Center"],
          city: row["City"],
          aadharNumber: row["Aadhar Number"],
          panNumber: row["PAN Number"],
          gstin: row["GST Number"],
          poiFrontImage: row["POI Front Image"],
          poiBackImage: row["POI Back Image"],
          outletImage: row["Outlet Image"],
          poaFrontImage: row["POA Front Image"],
          poaBackImage: row["POA Back Image"],
          enrollmentForm: row["Enrollment Form"],
          location: row["Landmark"],
          OutletsubBrands: row["Outlet subBrand"],
          categoryOfOutlet: row["Category Of Outlet"],
          productCategory: row["Product Category"],
          sellingBrands: sellingBrands.map((brand) => brand._id),
          competitorBrands: row["Competitor Brands"]?.split(";") || [],
          existingRetailer: row["Existing Retailer"],
          status: true,
          outletSource: "Admin",
        };
      })
    );

    await OutletApproved.insertMany(outlets, { ordered: false });
    fs.unlinkSync(filePath);

    res.status(201).json({ message: "Outlets uploaded successfully" });
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ message: err.message });
  }
});

module.exports = {
  outletApprovedBulk,
};
