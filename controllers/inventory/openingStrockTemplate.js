const fs = require("fs");
const path = require("path");
const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const Inventory = require("../../models/inventory.model");
const { SERVER_URL } = require("../../config/server.config");
const FormData = require("form-data");
const axios = require("axios");
const Distributor = require("../../models/distributor.model");

const generateCsv = asyncHandler(async (req, res) => {
  try {
    const distributorId = req.user?._id;

    // 1. Get distributor's brands
    const distributor = await Distributor.findById(
      distributorId,
      "brandId"
    ).lean();
    const brands = distributor?.brandId || [];

    // 2. Get all productIds in inventory for this distributor
    const inventoryProductIds = await Inventory.find(
      { distributorId },
      { productId: 1, _id: 0 }
    ).lean();

    const productIdsInInventory = inventoryProductIds.map((inv) =>
      inv.productId.toString()
    );

    // 3. Get products not in inventory
    const productFilter = brands.length
      ? { brand: { $in: brands }, _id: { $nin: productIdsInInventory } }
      : { _id: { $nin: productIdsInInventory } };

    const productsNotInInventory = await Product.find(productFilter, {
      product_code: 1,
      name: 1,
    }).lean();

    // 4. Generate CSV in memory
    let csvContent = "Product code,Product Name,Qty In Pcs,Stock Type\n";
    csvContent += productsNotInInventory
      .map(
        (product) => `"${product.product_code}","${product.name}",,"salable"`
      )
      .join("\n");

    // 5. Write to file (if you must)
    const filePath = path.join(__dirname, `transactions_${Date.now()}.csv`);
    fs.writeFileSync(filePath, csvContent);

    // 6. Upload to Cloudinary
    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `Opening_Stock_Template_${Date.now()}`);

    const result = await axios.post(
      `${SERVER_URL}/api/v1/cloudinary/upload`,
      formData,
      { headers: formData.getHeaders() }
    );

    // 7. Cleanup
    fs.unlinkSync(filePath);

    res.json({
      csvLink: result?.data?.secure_url,
      count: productsNotInInventory.length,
    });
  } catch (error) {
    console.error("CSV Generation Error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { generateCsv };
