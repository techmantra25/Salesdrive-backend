const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const csv = require("csv-parser");
const fs = require("fs");
const Brand = require("../../models/brand.model");

const bulkBrandEntry = asyncHandler(async (req, res) => {
  let filePath;
  try {
    const { csvUrl } = req.body;

    if (!csvUrl) {
      res.status(400);
      throw new Error("CSV URL is required");
    }

    const fileName = `${uuidv4()}.csv`;
    filePath = path.join(__dirname, fileName);

    // Download the file from the URL
    const response = await axios({
      method: "GET",
      url: csvUrl,
      responseType: "stream",
    });

    // Save the file locally
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", async () => {
      const results = [];

      // Read and parse the downloaded CSV file
      fs.createReadStream(filePath)
        .pipe(
          csv({
            headers: ["BRAND NAME", "BRAND DESCRIPTION", "IMAGE PATH"],
            skipLines: 1,
          })
        )
        .on("data", (data) => results.push(data))
        .on("end", async () => {
          try {
            let successCount = 0;
            let failedCount = 0;
            let duplicateCount = 0;
            const errors = [];
            const createdBrands = [];

            // Process each row from the CSV
            for (const [index, row] of results.entries()) {
              try {
                const brandName = row["BRAND NAME"]?.trim();
                const brandCode = row["BRAND NAME"]?.trim();
                const description = row["BRAND DESCRIPTION"]?.trim() || "";
                const imagePath = row["IMAGE PATH"]?.trim() || "";
                const slug = row["SLUG"]?.trim() || "";

                // Validate required fields
                if (!brandName || !brandCode) {
                  errors.push({
                    ...row,
                    index: index + 1,
                    reason: "Brand Name is required",
                  });
                  failedCount++;
                  continue;
                }

                // Check if brand with the same code already exists
                const existingBrand = await Brand.findOne({ code: brandCode });

                if (existingBrand) {
                  // If the brand code exists but the name is different, count as failed
                  if (existingBrand.name !== brandName) {
                    errors.push({
                      ...row,
                      index: index + 1,
                      reason: `Brand with name ${brandCode} already exists with a different name`,
                    });
                    failedCount++;
                  } else {
                    // If the brand code and name are the same, count as duplicate
                    duplicateCount++;
                    errors.push({
                      ...row,
                      index: index + 1,
                      reason: `Brand with name ${brandCode} already exists`,
                    });
                  }
                  continue;
                }

                // Create new brand
                const newBrand = new Brand({
                  name: brandName,
                  code: brandCode,
                  desc: description,
                  image_path: imagePath || null,
                  slug: slug || null,
                  status: true,
                });

                const savedBrand = await newBrand.save();
                createdBrands.push(savedBrand);
                successCount++;
              } catch (err) {
                errors.push({
                  ...row,
                  index: index + 1,
                  reason: err.message,
                });
                failedCount++;
              }
            }

            // Delete the local file after processing
            fs.unlinkSync(filePath);

            res.status(200).json({
              error: false,
              message: "Bulk brand import completed",
              data: createdBrands,
              skippedRows: errors ?? [],
              summary: {
                total: results.length,
                success: successCount,
                failed: failedCount,
                duplicates: duplicateCount,
              },
            });
          } catch (err) {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            res.status(500).json({ message: err.message });
          }
        });
    });

    writer.on("error", (err) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      res
        .status(500)
        .json({ message: `Failed to write the file: ${err.message}` });
    });
  } catch (error) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(400);
    throw error;
  }
});

module.exports = { bulkBrandEntry };
