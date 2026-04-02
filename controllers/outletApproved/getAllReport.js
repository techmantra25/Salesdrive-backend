const asyncHandler = require("express-async-handler");
const cloudinary = require("cloudinary").v2;
const { Parser } = require("json2csv");
const path = require("path");
const fs = require("fs");
const OutletApproved = require("../../models/outletApproved.model");
const { formatDate } = require("../../utils/formateDate");
const { SERVER_URL } = require("../../config/server.config");
const { default: axios } = require("axios");
const FormData = require("form-data");

const getAllReport = asyncHandler(async (req, res) => {
  try {
    const query = {};

    if (req.query.statusFilter) {
      query.status = req.query.statusFilter;
    }

    if (req.query.regionId) {
      query.regionId = req.query.regionId;
    }

    if (req.query.distributorId) {
      query.distributorId = req.query.distributorId;
    }

    if (req.query.beatId) {
      query.beatId = req.query.beatId;
    }

    if (req.query.fromDate && req.query.toDate) {
      query.createdAt = {};
      if (req.query.fromDate) {
        const startOfDay = new Date(req.query.fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        query.createdAt.$gte = startOfDay;
      }
      if (req.query.toDate) {
        const endOfDay = new Date(req.query.fromDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endOfDay;
      }
    }

    const outletsApproved = await OutletApproved.find(query)
      .populate([
        {
          path: "zoneId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "beatId",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "sellingBrands",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    const csvData = outletsApproved.map((outlet) => {
      return {
        outletCode: outlet?.outletCode,
        outletUID: outlet?.outletUID,
        outletName: outlet?.outletName,
        ownerName: outlet?.ownerName,
        address1: outlet?.address1,
        address2: outlet?.address2,
        marketCenter: outlet?.marketCenter,
        zoneCode: outlet?.zoneId?.code,
        zoneName: outlet?.zoneId?.name,
        stateCode: outlet?.stateId?.code,
        stateName: outlet?.stateId?.name,
        regionCode: outlet?.regionId?.code,
        regionName: outlet?.regionId?.name,
        beatCode: outlet?.beatId?.code,
        beatName: outlet?.beatId?.name,
        distributorCode: outlet?.distributorId?.dbCode,
        distributorName: outlet?.distributorId?.name,
        city: outlet?.city,
        pin: outlet?.pin,
        district: outlet?.district,
        mobile1: outlet?.mobile1,
        mobile2: outlet?.mobile2,
        teleCallingSlot: outlet?.teleCallingSlot?.join("; "),
        categoryOfOutlet: outlet?.categoryOfOutlet,
        productCategory: outlet?.productCategory,
        OutletSegments: outlet?.OutletSegments,
        sellingBrands: outlet?.sellingBrands
          ?.map((brand) => brand?.name)
          ?.join("; "),
        competitorBrands: outlet?.competitorBrands?.join("; "),
        poiFrontImage: outlet?.poiFrontImage,
        poiBackImage: outlet?.poiBackImage,
        outletImage: outlet?.outletImage,
        poaFrontImage: outlet?.poaFrontImage,
        poaBackImage: outlet?.poaBackImage,
        enrollmentForm: outlet?.enrollmentForm,
        existingRetailer: outlet?.existingRetailer ? "Yes" : "No",
        status: outlet?.status ? "Active" : "Inactive",
        approvedDate: formatDate(outlet?.approvedDate),
        createdAt: formatDate(outlet?.createdAt),
      };
    });

    const fields = [
      {
        label: "Outlet Code",
        value: "outletCode",
      },
      {
        label: "Outlet UID",
        value: "outletUID",
      },
      {
        label: "Outlet Name",
        value: "outletName",
      },
      {
        label: "Owner Name",
        value: "ownerName",
      },
      {
        label: "Address 1",
        value: "address1",
      },
      {
        label: "Address 2",
        value: "address2",
      },
      {
        label: "Market Center",
        value: "marketCenter",
      },
      {
        label: "Zone Code",
        value: "zoneCode",
      },
      {
        label: "Zone",
        value: "zoneName",
      },
      {
        label: "State Code",
        value: "stateCode",
      },
      {
        label: "State",
        value: "stateName",
      },
      {
        label: "Region Code",
        value: "regionCode",
      },
      {
        label: "Region",
        value: "regionName",
      },
      {
        label: "Beat Code",
        value: "beatCode",
      },
      {
        label: "Beat",
        value: "beatName",
      },
      {
        label: "Distributor Code",
        value: "distributorCode",
      },
      {
        label: "Distributor Name",
        value: "distributorName",
      },
      {
        label: "City",
        value: "city",
      },
      {
        label: "PIN",
        value: "pin",
      },
      {
        label: "District",
        value: "district",
      },
      {
        label: "Mobile 1",
        value: "mobile1",
      },
      {
        label: "Mobile 2",
        value: "mobile2",
      },
      {
        label: "Tele-calling Slot",
        value: "teleCallingSlot",
      },
      {
        label: "Category of Outlet",
        value: "categoryOfOutlet",
      },
      {
        label: "Product Category",
        value: "productCategory",
      },
      {
        label: "Outlet Segments",
        value: "OutletSegments",
      },
      {
        label: "Selling Brands",
        value: "sellingBrands",
      },
      {
        label: "Competitor Brands",
        value: "competitorBrands",
      },
      {
        label: "POI Front Image",
        value: "poiFrontImage",
      },
      {
        label: "POI Back Image",
        value: "poiBackImage",
      },
      {
        label: "Outlet Image",
        value: "outletImage",
      },
      {
        label: "POA Front Image",
        value: "poaFrontImage",
      },
      {
        label: "POA Back Image",
        value: "poaBackImage",
      },
      {
        label: "Enrollment Form",
        value: "enrollmentForm",
      },
      {
        label: "Existing Retailer",
        value: "existingRetailer",
      },
      {
        label: "Status",
        value: "status",
      },
      {
        label: "Approved Date",
        value: "approvedDate",
      },
      {
        label: "Created At",
        value: "createdAt",
      },
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);

    // Save CSV file to the server temporarily
    const filePath = path.join(__dirname, "outlets.csv");
    fs.writeFileSync(filePath, csv);

    // Upload CSV file to Cloudinary
    // const result = await cloudinary.uploader.upload(filePath, {
    //   resource_type: "raw",
    //   public_id: `outlets-${Date.now()}`,
    //   folder: "lux-dms",
    // });

    const formData = new FormData();
    formData.append("my_file", fs.createReadStream(filePath));
    formData.append("fileName", `outlets-${Date.now()}`);
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
      message: "Outlet Approved list",
      data: {
        csvLink: result.data?.secure_url,
        count: outletsApproved.length,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  getAllReport,
};
