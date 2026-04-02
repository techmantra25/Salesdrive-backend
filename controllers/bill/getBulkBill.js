const asyncHandler = require("express-async-handler");
const axios = require("axios");
const fs = require("fs");
const Bill = require("../../models/bill.model");
const { SERVER_URL } = require("../../config/server.config");
const FormData = require("form-data");
const generatePDF = require("./util/generatePDF");
const DBRule = require("../../models/dbRule.model");

const CLOUDINARY_UPLOAD_URL = `${SERVER_URL}/api/v1/cloudinary/upload`;

const uploadToCloudinary = async (filePath, billNo) => {
  try {
    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `${billNo}-${Date.now()}`);

    const response = await axios.post(CLOUDINARY_UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    return response.data.secure_url;
  } catch (error) {
    throw error;
  }
};

const getBulkBill = asyncHandler(async (req, res) => {
  try {
    const { billIds } = req.body;
    const regenerate = req.body?.regenerate ?? false;

    if (!billIds || !billIds.length) {
      return res.status(400).json({ message: "Bill IDs are required" });
    }

    let bills = await Bill.find({ _id: { $in: billIds } }).populate([
      {
        path: "distributorId",
        populate: [
          { path: "stateId", select: "" },
          { path: "regionId", select: "" },
        ],
      },
      { path: "salesmanName", select: "" },
      { path: "routeId", select: "" },
      { path: "orderId", select: "" },
      { path: "retailerId", select: "" },
      { path: "lineItems.product", select: "" },
      { path: "lineItems.price", select: "" },
      { path: "lineItems.inventoryId", select: "" },
    ]);

    for (let i = 0; i < bills.length; i++) {
      const bill = bills[i];
      const billNo = bill?.billNo;
      const billLastUpdatedAt = bill.updatedAt;
      const billUrlLastUpdatedAt = bill?.printUrl?.lastUpdated;

      // when bill ui changes, we need to make it if we make any changes to bill ui >= , normally it should be <=

      if (
        regenerate ||
        !billUrlLastUpdatedAt ||
        billLastUpdatedAt <= billUrlLastUpdatedAt
      ) {
        const termConditions = await DBRule.findOne({
          dbId: bill?.distributorId?._id,
          module: "Invoice T&C",
        });

        if (termConditions) {
          bill.termConditions = termConditions?.rules;
        } else {
          bill.termConditions = [];
        }

        // Generate new PDF
        const pdfPath = await generatePDF(bill);

        // Upload PDF to Cloudinary
        const pdfUrl = await uploadToCloudinary(pdfPath, billNo);

        // Update bill with new print URL
        bill.printUrl = { url: pdfUrl, lastUpdated: new Date() };
        await bill.save();

        // Delete temp file
        fs.unlinkSync(pdfPath);
      }
    }

    bills = bills.map((bill) => ({
      _id: bill._id,
      billNo: bill.billNo,
      printUrl: bill.printUrl,
    }));

    res.status(200).json({
      error: false,
      status: 200,
      message: "Bulk bills fetched successfully",
      data: bills,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { getBulkBill };
