const asyncHandler = require("express-async-handler");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const csv = require("csv-parser");
const fs = require("fs");
const SubBrand = require("../../models/subBrand.model");
const Brand = require("../../models/brand.model"); // Assuming you have a Brand model

const bulkSubBrandCreate = asyncHandler(async (req, res) => {
  let filePath;
  try {
    const { csvUrl } = req.body;

    if (!csvUrl) {
      res.status(400);
      throw new Error("CSV URL is required");
    }

    const fileName = `${uuidv4()}.csv`;
    filePath = path.join(__dirname, fileName);

    const response = await axios({
      method: "GET",
      url: csvUrl,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", async () => {
      const results = [];

      fs.createReadStream(filePath)
        .pipe(
          csv({
            headers: [
              "BRAND NAME",
              "SUB BRAND NAME",
              "SUB BRAND DESCRIPTION",
              "IMAGE PATH",
            ],
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
            const createdSubBrands = [];

            for (const [index, row] of results.entries()) {
              try {
                const brandName = row["BRAND NAME"]?.trim();
                const subBrandName = row["SUB BRAND NAME"]?.trim();
                const description = row["SUB BRAND DESCRIPTION"]?.trim() || "";
                const imagePath = row["IMAGE PATH"]?.trim() || "";
                const brandCode = subBrandName;

                if (!brandName || !subBrandName) {
                  errors.push({
                    ...row,
                    index: index + 1,
                    reason: "Brand Name and Sub Brand Name are required",
                  });
                  failedCount++;
                  continue;
                }

                // Fetch brandId from brand name
                const brand = await Brand.findOne({ name: brandName });
                if (!brand) {
                  errors.push({
                    ...row,
                    index: index + 1,
                    reason: `Brand '${brandName}' not found`,
                  });
                  failedCount++;
                  continue;
                }

                // Check for existing SubBrand
                const existingSubBrand = await SubBrand.findOne({
                  code: brandCode,
                  brandId: brand._id,
                });

                if (existingSubBrand) {
                  if (existingSubBrand.name !== subBrandName) {
                    errors.push({
                      ...row,
                      index: index + 1,
                      reason: `SubBrand with name ${brandCode} already exists with a different name`,
                    });
                    failedCount++;
                  } else {
                    duplicateCount++;
                    errors.push({
                      ...row,
                      index: index + 1,
                      reason: `SubBrand with name ${brandCode} already exists`,
                    });
                  }
                  continue;
                }

                // Create new SubBrand
                const newSubBrand = new SubBrand({
                  name: subBrandName,
                  code: brandCode,
                  desc: description,
                  image_path: imagePath,
                  brandId: brand._id,
                  status: true,
                });

                const saved = await newSubBrand.save();
                createdSubBrands.push(saved);
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

            fs.unlinkSync(filePath);

            res.status(201).json({
              error: false,
              message: "Bulk SubBrand import completed",
              data: createdSubBrands,
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
      res.status(500).json({ message: `File write failed: ${err.message}` });
    });
  } catch (error) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.status(400);
    throw error;
  }
});

module.exports = { bulkSubBrandCreate };
