const asyncHandler = require("express-async-handler");
const { Parser } = require("json2csv");

const Product = require("../../models/product.model")


// const bulkUpdateEanCode = asyncHandler(async (req, res) => {
//   const rows = req.body.rows;

//   if (!Array.isArray(rows) || rows.length === 0) {
//     return res.status(400).json({ message: "No data received" });
//   }

//   // ── Process each row ─────────────────────────────────────────────────────
//   let updated = 0;
//   let skipped = 0;          // product not found in DB
//   let alreadyPopulated = 0; // EAN already set and unchanged
//   const failedRows = [];

//   for (let i = 0; i < rows.length; i++) {
//     const row = rows[i];
//     const rowNumber = i + 2; // account for header row

//     try {
//       const rowErrors = [];

//       // ── Extract & validate fields ────────────────────────────────────────
//       const materialCode = row["MATERIAL CODE"]?.toString().trim();
//       const eanCode = row["EANCODE"]?.toString().trim();

//       if (!materialCode) {
//         rowErrors.push("Missing MATERIAL CODE");
//       }

//       if (!eanCode) {
//         rowErrors.push("Missing EANCODE");
//       }

//       if (rowErrors.length > 0) {
//         throw new Error(rowErrors.join(", "));
//       }

//       // ── Lookup product ───────────────────────────────────────────────────
//       const product = await Product.findOne({ product_code: materialCode });

//       if (!product) {
//         skipped++;
//         failedRows.push({
//           ...row,
//           "Row Number": rowNumber,
//           "Error Reason": `No product found with product_code "${materialCode}"`,
//         });
//         continue;
//       }

//       // ── Skip if EAN already matches ──────────────────────────────────────
//       if (product.ean11 && product.ean11 === eanCode) {
//         alreadyPopulated++;
//         continue;
//       }

//       // ── Update ean11 (insert or overwrite) ───────────────────────────────
//       product.ean11 = eanCode;
//       await product.save();

//       updated++;
//     } catch (rowError) {
//       failedRows.push({
//         ...row,
//         "Row Number": rowNumber,
//         "Error Reason": rowError.message,
//       });
//     }
//   }

//   // ── Build failed-rows CSV if needed ────────────────────────────────────────
//   let failedCSV = null;
//   if (failedRows.length > 0) {
//     const parser = new Parser();
//     const csv = parser.parse(failedRows);
//     failedCSV = Buffer.from(csv).toString("base64");
//   }

//   // ── Respond ─────────────────────────────────────────────────────────────────
//   return res.status(200).json({
//     message: "Bulk EAN update completed",
//     totalRows: rows.length,
//     updated,
//     alreadyPopulated,
//     skipped,
//     failed: failedRows.length,
//     failedCSV, // base64-encoded CSV of failed rows, null if none
//   });
// });


const bulkUpdateEanCode = asyncHandler(async(req,res) =>{
  const rows = req.body.rows;

  if(!Array.isArray(rows) || rows.length === 0){
    return res.status(400).json({message:"No data recived"});
  }
  const validRows = rows.filter(
    (row) => row["MATERIAL CODE"]?.toString().trim() && row["EANCODE"]?.toString().trim()
  );
  const invalidCount = rows.length-validRows.length;
  if(validRows.length  === 0){
    return res.status(400).json({message:"No valid rows found"});
  }
  const bulkOps = validRows.map((row) => ({
    updateOne:{
      filter: { product_code: row["MATERIAL CODE"].toString().trim() },
      update: { $set: { ean11: row["EANCODE"].toString().trim() } },
    }
  }));

  const batchSize = 1000;
  let totalMatched =0;
  let totalModified = 0;

  for(let i=0; i<bulkOps.length; i += batchSize){
    const batch = bulkOps.slice(i, i + batchSize);
    const result = await Product.bulkWrite(batch, { ordered: false });
    totalMatched += result.matchedCount;
    totalModified += result.modifiedCount;
  }
  const notFound = validRows.length -totalMatched;

  return res.status(200).json({
    message: "Bulk EAN update completed",
    totalRows: rows.length,
    updated: totalModified,
    alreadyPopulated: totalMatched - totalModified,
    skipped: notFound,
    failed: invalidCount,
  })
  
}) 

module.exports = { bulkUpdateEanCode };