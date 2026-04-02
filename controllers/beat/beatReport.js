const asyncHandler = require("express-async-handler");
const Beat = require("../../models/beat.model");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");
const cloudinary = require("cloudinary").v2;
const FormData = require("form-data");
const { SERVER_URL } = require("../../config/server.config");
const { default: axios } = require("axios");

const beatReport = asyncHandler(async (req, res) => {
  try {
    let { status, regionId, distributorId } = req.query;

    let filter = {};
    if (status) {
      filter.status = status === "true";
    }
    if (regionId) {
      filter.regionId = regionId;
    }
    if (distributorId) {
      filter.distributorId = { $in: [distributorId] };
    }

    const beats = await Beat.find(filter)
      .populate([
        {
          path: "regionId",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "employeeId",
          select: "",
          populate: [
            {
              path: "desgId",
              select: "",
            },
          ],
        },
      ])
      .sort({ _id: -1 });

    // Map the data to CSV format - create separate row for each distributor
    const csvData = [];

    beats.forEach((beat) => {
      if (beat?.distributorId && beat.distributorId.length > 0) {
        // Create a row for each distributor
        beat.distributorId.forEach((distributor) => {
          csvData.push({
            "Beat Code": beat?.code,
            "Beat Name": beat?.name,
            "Beat Ids": beat?.beatIds?.join(", ") || "",
            "Beat Type": beat?.beat_type,
            "Region Code": beat?.regionId?.code,
            "Region Name": beat?.regionId?.name,
            "Distributor Code": distributor?.dbCode || "",
            "Distributor Name": distributor?.name || "",
            Status: beat.status ? "Active" : "Inactive",
          });
        });
      } else {
        // If no distributors, create a row with empty distributor fields
        csvData.push({
          "Beat Code": beat?.code,
          "Beat Name": beat?.name,
          "Beat Ids": beat?.beatIds?.join(", ") || "",
          "Beat Type": beat?.beat_type,
          "Region Code": beat?.regionId?.code,
          "Region Name": beat?.regionId?.name,
          "Distributor Code": "",
          "Distributor Name": "",
          Status: beat.status ? "Active" : "Inactive",
        });
      }
    });

    // Define the fields to be exported
    const fields = [
      { label: "Beat Code", value: "Beat Code" },
      { label: "Beat Name", value: "Beat Name" },
      { label: "Beat Ids", value: "Beat Ids" },
      { label: "Beat Type", value: "Beat Type" },
      { label: "Region Code", value: "Region Code" },
      { label: "Region Name", value: "Region Name" },
      { label: "Distributor Code", value: "Distributor Code" },
      { label: "Distributor Name", value: "Distributor Name" },
      { label: "Status", value: "Status" },
    ];

    // Create CSV
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    // Save CSV file to the server temporarily
    const filePath = path.join(__dirname, "beats.csv");
    fs.writeFileSync(filePath, csv);

    // Upload CSV file to Cloudinary
    // const result = await cloudinary.uploader.upload(filePath, {
    //   resource_type: "raw",
    //   public_id: `beats-${Date.now()}`,
    //   folder: "lux-dms",
    // });

    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `beats-${Date.now()}`);
    const CLOUDINARY_UPLOAD_URL = `${SERVER_URL}/api/v1/cloudinary/upload`;

    const result = await axios.post(CLOUDINARY_UPLOAD_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Remove the temporary file
    fs.unlinkSync(filePath);

    return res.status(200).json({
      status: 200,
      message: "Beats report generated successfully",
      data: {
        csvLink: result?.data?.secure_url,
        count: csvData.length,
        beatsCount: beats.length,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { beatReport };
