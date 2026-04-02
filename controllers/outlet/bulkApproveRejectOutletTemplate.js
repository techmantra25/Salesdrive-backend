const asyncHandler = require("express-async-handler");
const { Parser } = require("json2csv");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { formatDate } = require("../../utils/formateDate");
const { mapStatus } = require("../../utils/mapStatus");
const Outlet = require("../../models/outlet.model");
const { getHierarchy } = require("./getHierarchy");
const { default: axios } = require("axios");
const { SERVER_URL } = require("../../config/server.config");
const FormData = require("form-data");

const bulkApproveRejectOutletTemplate = asyncHandler(async (req, res) => {
  try {
    let { zoneId, stateId, regionId, outletStatus, fromDate, toDate } =
      req.query;
    let selectedOutletIds = req.body.selectedOutletIds;

    // Build the filter object
    const filter = {};
    if (outletStatus !== undefined) filter.outletStatus = outletStatus;
    if (selectedOutletIds && selectedOutletIds.length > 0) {
      // Convert selectedOutletIds to ObjectId type
      selectedOutletIds = selectedOutletIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      );
      filter._id = { $in: selectedOutletIds };
    }

    // Add date range filtering
    if (fromDate && toDate) {
      filter.createdAt = {};
      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = startOfDay;
      }
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "employees",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
        },
      },
      { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "regions",
          localField: "employee.regionId",
          foreignField: "_id",
          as: "region",
        },
      },
      { $unwind: { path: "$region", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "zones",
          localField: "employee.zoneId",
          foreignField: "_id",
          as: "zone",
        },
      },
      { $unwind: { path: "$zone", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "states",
          localField: "region.stateId",
          foreignField: "_id",
          as: "state",
        },
      },
      { $unwind: { path: "$state", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "distributors",
          localField: "distributorId",
          foreignField: "_id",
          as: "distributor",
        },
      },
      { $unwind: { path: "$distributor", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "beats",
          localField: "beatId",
          foreignField: "_id",
          as: "beat",
        },
      },
      { $unwind: { path: "$beat", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "brands",
          localField: "sellingBrands",
          foreignField: "_id",
          as: "sellingBrandsDetails",
        },
      },
      {
        $unwind: {
          path: "$sellingBrandsDetails",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: "$_id",
          leadId: { $first: "$leadId" },
          zone: { $first: "$zone" },
          region: { $first: "$region" },
          state: { $first: "$state" },
          employee: { $first: "$employee" },
          distributor: { $first: "$distributor" },
          beat: { $first: "$beat" },
          createdAt: { $first: "$createdAt" },
          updatedAt: { $first: "$updatedAt" },
          outletStatus: { $first: "$outletStatus" },
          approvedDate: { $first: "$approvedDate" },
          outletCode: { $first: "$outletCode" },
          outletUID: { $first: "$outletUID" },
          outletName: { $first: "$outletName" },
          ownerName: { $first: "$ownerName" },
          address1: { $first: "$address1" },
          address2: { $first: "$address2" },
          location: { $first: "$location" },
          marketCenter: { $first: "$marketCenter" },
          city: { $first: "$city" },
          pin: { $first: "$pin" },
          district: { $first: "$district" },
          mobile1: { $first: "$mobile1" },
          mobile2: { $first: "$mobile2" },
          teleCallingSlot: { $first: "$teleCallingSlot" },
          teleCallDay: { $first: "$teleCallDay" },
          preferredLanguage: { $first: "$preferredLanguage" },
          poiFrontImage: { $first: "$poiFrontImage" },
          poiBackImage: { $first: "$poiBackImage" },
          outletImage: { $first: "$outletImage" },
          poaFrontImage: { $first: "$poaFrontImage" },
          poaBackImage: { $first: "$poaBackImage" },
          enrollmentForm: { $first: "$enrollmentForm" },
          outletSegment: { $first: "$outletSegment" },
          aadharNumber: { $first: "$aadharNumber" },
          panNumber: { $first: "$panNumber" },
          gstin: { $first: "$gstin" },
          existingRetailer: { $first: "$existingRetailer" },
          outletSource: { $first: "$outletSource" },
          remarks: { $first: "$remarks" },
          categoryOfOutlet: { $first: "$categoryOfOutlet" },
          productCategory: { $first: "$productCategory" },
          competitorBrands: { $first: "$competitorBrands" },
          sellingBrands: {
            $push: {
              name: "$sellingBrandsDetails.name",
              code: "$sellingBrandsDetails.code",
            },
          },
        },
      },
    ];

    const { ObjectId } = mongoose.Types;

    // Apply filters for zone, state, and region
    if (zoneId) {
      pipeline.push({ $match: { "zone._id": new ObjectId(zoneId) } });
    }
    if (stateId) {
      pipeline.push({ $match: { "state._id": new ObjectId(stateId) } });
    }
    if (regionId) {
      pipeline.push({ $match: { "region._id": new ObjectId(regionId) } });
    }

    // Pagination and sorting
    pipeline.push({ $sort: { _id: -1 } });

    // Execute the aggregation pipeline
    const outlets = await Outlet.aggregate(pipeline);

    // Prepare the data with custom formatting
    const csvData = await Promise.all(
      outlets.map(async (outlet) => {
        const empHierarchy = await getHierarchy(outlet?.employee?._id);

        return {
          leadId: outlet?.leadId,
          zoneName: outlet?.zone?.name,
          regionName: outlet?.region?.name,
          stateName: outlet?.state?.name,
          empId: outlet?.employee?.empId,
          empName: outlet?.employee?.name,
          dbCode: outlet?.distributor?.dbCode,
          dbName: outlet?.distributor?.name,
          beatCode: outlet?.beat?.code,
          beatName: outlet?.beat?.name,
          zsm: empHierarchy?.ZSM?.name,
          rsm: empHierarchy?.RSM?.name,
          asm: empHierarchy?.ASM?.name,
          createdAt: formatDate(outlet?.createdAt),
          updatedAt: formatDate(outlet?.updatedAt),
          outletStatus: mapStatus(outlet?.outletStatus),
          approvedDate: formatDate(outlet?.approvedDate),
          outletCode: outlet?.outletCode,
          outletUID: outlet?.outletUID,
          outletName: outlet?.outletName,
          ownerName: outlet?.ownerName,
          address1: outlet?.address1,
          address2: outlet?.address2,
          location: outlet?.location,
          marketCenter: outlet?.marketCenter,
          city: outlet?.city,
          pin: outlet?.pin,
          district: outlet?.district,
          mobileNo: outlet?.mobile1,
          alternateMobileNo: outlet?.mobile2,
          teleCallingSlot: outlet?.teleCallingSlot,
          teleCallDay: outlet?.teleCallDay,
          poiFrontImage: outlet?.poiFrontImage,
          poiBackImage: outlet?.poiBackImage,
          outletImage: outlet?.outletImage,
          poaFrontImage: outlet?.poaFrontImage,
          poaBackImage: outlet?.poaBackImage,
          enrollmentForm: outlet?.enrollmentForm,
          outletSegment: outlet?.OutletSegments,
          categoryOfOutlet: outlet?.categoryOfOutlet,
          aadharNumber: outlet?.aadharNumber,
          panNumber: outlet?.panNumber,
          gstin: outlet?.gstin,
          preferredLanguage: outlet?.preferredLanguage,
          productCategory: outlet?.productCategory,
          sellingBrands: outlet?.sellingBrands
            ?.map((brand) => brand?.name)
            ?.join(";"),
          competitorBrands: outlet?.competitorBrands?.join(";"),
          existingRetailer: outlet?.existingRetailer ? "Yes" : "No",
          outletSource: "SFA",
          remarks: outlet?.remarks,
        };
      })
    );

    // Define CSV headers
    const fields = [
      { label: "Lead Id", value: "leadId" },
      { label: "Zone", value: "zoneName" },
      { label: "Region", value: "regionName" },
      { label: "State", value: "stateName" },
      { label: "Employee Code", value: "empId" },
      { label: "Employee Name", value: "empName" },
      { label: "DB Code", value: "dbCode" },
      { label: "DB Name", value: "dbName" },
      { label: "Beat Code", value: "beatCode" },
      { label: "Beat Name", value: "beatName" },
      { label: "ZSM Name", value: "zsm" },
      { label: "RSM Name", value: "rsm" },
      { label: "ASM Name", value: "asm" },
      { label: "Lead Record Date", value: "createdAt" },
      { label: "Lead Modified Date", value: "updatedAt" },
      { label: "Approval Status", value: "outletStatus" },
      { label: "Approved Date", value: "approvedDate" },
      { label: "Outlet Code", value: "outletCode" },
      { label: "Outlet UID", value: "outletUID" },
      { label: "Outlet Name", value: "outletName" },
      { label: "Owner Name", value: "ownerName" },
      { label: "Address 1", value: "address1" },
      { label: "Address 2", value: "address2" },
      { label: "Landmark", value: "location" },
      { label: "Market Center", value: "marketCenter" },
      { label: "City/Village", value: "city" },
      { label: "Pin Code", value: "pin" },
      { label: "District", value: "district" },
      { label: "Mobile No", value: "mobileNo" },
      { label: "Alternate Mobile No", value: "alternateMobileNo" },
      { label: "Tele Calling Slot", value: "teleCallingSlot" },
      { label: "Tele Call Day", value: "teleCallDay" },
      { label: "POI Front Image", value: "poiFrontImage" },
      { label: "POI Back Image", value: "poiBackImage" },
      { label: "Outlet Image", value: "outletImage" },
      { label: "POA Front Image", value: "poaFrontImage" },
      { label: "POA Back Image", value: "poaBackImage" },
      { label: "Enrollment Form", value: "enrollmentForm" },
      { label: "Preferred Language", value: "preferredLanguage" },
      { label: "Aadhaar Number", value: "aadharNumber" },
      { label: "PAN Number", value: "panNumber" },
      { label: "GSTIN", value: "gstin" },
      { label: "Outlet Segment", value: "outletSegment" },
      { label: "Category Of Outlet", value: "categoryOfOutlet" },
      { label: "Product Category", value: "productCategory" },
      { label: "Selling Brands", value: "sellingBrands" },
      { label: "Competitor Brands", value: "competitorBrands" },
      { label: "Existing Retailer", value: "existingRetailer" },
      { label: "OutletSource", value: "outletSource" },
      { label: "Remarks", value: "remarks" },
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
      message: "All outlets list",
      data: {
        csvLink: result.data.secure_url,
        count: outlets.length,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  bulkApproveRejectOutletTemplate,
};
