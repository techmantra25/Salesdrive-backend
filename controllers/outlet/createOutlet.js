const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");
const { getHierarchy } = require("./getHierarchy");

const createOutlet = asyncHandler(async (req, res) => {
  const {
    stateId,
    gpsLocation,
    distributorId,
    outletCode,
    outletUID,
    outletName,
    ownerName,
    pin,
    district,
    mobile1,
    mobile2,
    whatsappNumber,
    teleCallingSlot,
    preferredLanguage,
    teleCallDay,
    beatId,
    address1,
    address2,
    marketCenter,
    city,
    aadharNumber,
    panNumber,
    gstin,
    poiFrontImage,
    poiBackImage,
    outletImage,
    poaFrontImage,
    poaBackImage,
    enrollmentForm,
    location,
    categoryOfOutlet,
    sellingBrands,
    competitorBrands,
    existingRetailer,
    outletStatus,
    approvedDate,
    enrolledByUser,
    leadStatus,
    outletSource,
    createdBy,
    createdBy_type,
    employeeId,
    contactPerson,
    email,
    retailerClass,
    enrolledStatus,
    shipToAddress,
    shipToPincode,
  } = req.body;

  // Generate unique lead ID
  const leadId = Math.floor(10000 + Math.random() * 90000);

  // Get employee hierarchy
  const empHierarchy = await getHierarchy(employeeId);

  // Check if outlet already exists
  const existingOutlet = await Outlet.findOne({
    $or: [{ outletCode }, { outletUID }],
  });

  if (existingOutlet) {
    return res.status(400).json({
      status: 400,
      message: "Outlet with this code or UID already exists",
    });
  }

  // Create outlet data object
  const outletData = {
    leadId,
    stateId,
    zsm: empHierarchy?.ZSM?._id,
    rsm: empHierarchy?.RSM?._id,
    asm: empHierarchy?.ASM?._id,
    gpsLocation,
    distributorId,
    outletCode,
    outletUID,
    outletName,
    ownerName,
    pin,
    beatId,
    district,
    mobile1,
    mobile2,
    whatsappNumber,
    teleCallingSlot,
    preferredLanguage,
    teleCallDay,
    address1,
    address2,
    marketCenter,
    city,
    aadharNumber,
    panNumber,
    gstin,
    poiFrontImage,
    poiBackImage,
    outletImage,
    poaFrontImage,
    poaBackImage,
    enrollmentForm,
    location,
    categoryOfOutlet,
    sellingBrands,
    competitorBrands,
    existingRetailer,
    outletStatus,
    approvedDate,
    enrolledByUser,
    leadStatus,
    outletSource,
    createdBy,
    createdBy_type,
    employeeId,
    contactPerson,
    email,
    retailerClass,
    enrolledStatus,
    shipToAddress,
    shipToPincode,
  };

  const newOutlet = await Outlet.create(outletData);

  return res.status(201).json({
    status: 201,
    message: "Outlet created successfully",
    data: newOutlet,
  });
});

module.exports = {
  createOutlet,
};
