const asyncHandler = require("express-async-handler");
const axios = require("axios");
const fs = require("fs");
const LoadSheet = require("../../models/loadSheet.model");
const { SERVER_URL } = require("../../config/server.config");
const FormData = require("form-data");
const generateLoadSheetPDF = require("./util/generateLoadSheetPDF");

const CLOUDINARY_UPLOAD_URL = `${SERVER_URL}/api/v1/cloudinary/upload`;

const uploadToCloudinary = async (filePath, allocationNo) => {
  try {
    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `${allocationNo}-${Date.now()}`);

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

const loadSheetPrint = asyncHandler(async (req, res) => {
  try {
    const { loadSheetIds } = req.body;
    const regenerate = req.body?.regenerate ?? false;

    if (!loadSheetIds || !loadSheetIds.length) {
      res.status(400);
      throw new Error("Load Sheet IDs are required");
    }

    let loadSheets = await LoadSheet.find({
      _id: { $in: loadSheetIds },
    }).populate([
      {
        path: "billIds",
        select: "",
        populate: {
          path: "lineItems.product",
          select: "",
        },
      },
      {
        path: "vehicleId",
        select: "",
      },
      {
        path: "deliveryBoyId",
        select: "",
      },
      {
        path: "beatId",
        select: "",
      },
      {
        path: "retailerId",
        select: "",
      },
    ]);

    if (!loadSheets.length) {
      res.status(400);
      throw new Error("No load sheets found");
    }

    for (let i = 0; i < loadSheets.length; i++) {
      const loadSheet = loadSheets[i];
      const allocationNo = loadSheet?.allocationNo;
      const loadSheetLastUpdatedAt = loadSheet.updatedAt;
      const printUrlLastUpdatedAt = loadSheet?.printUrl?.lastUpdated;

      if (
        regenerate ||
        !printUrlLastUpdatedAt ||
        printUrlLastUpdatedAt <= loadSheetLastUpdatedAt
      ) {
        const pdfPath = await generateLoadSheetPDF(loadSheet);
        const pdfUrl = await uploadToCloudinary(pdfPath, allocationNo);

        loadSheet.printUrl = {
          url: pdfUrl,
          lastUpdated: new Date(),
        };

        await loadSheet.save();

        fs.unlinkSync(pdfPath);
      }
    }

    loadSheets = loadSheets.map((loadSheet) => {
      return {
        _id: loadSheet._id,
        allocationNo: loadSheet.allocationNo,
        printUrl: loadSheet.printUrl,
      };
    });

    res.status(200).json({
      error: false,
      status: 200,
      message: "Load Sheet print URL generated successfully",
      data: loadSheets,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { loadSheetPrint };
