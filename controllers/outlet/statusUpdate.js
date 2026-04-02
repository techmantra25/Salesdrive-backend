const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");
const Employee = require("../../models/employee.model");
const { outletImpCode } = require("../../utils/codeGenerator");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Distributor = require("../../models/distributor.model");
const OutletApproved = require("../../models/outletApproved.model");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const statusUpdate = asyncHandler(async (req, res) => {
  try {
    let updatedOutlet = await Outlet.findById(req.params.outletId);

    if (!updatedOutlet) {
      res.status(404);
      throw new Error("Outlet not found");
    }

    if (req.body.outletStatus === "Approved") {
      if (!req.body.beatId) {
        res.status(400);
        throw new Error("beatId is required");
      }
      const empData = await Employee.findOne({
        _id: updatedOutlet?.employeeId,
      });
      const regionData = await Region.findOne({ _id: empData?.regionId });
      const stateData = await State.findOne({ _id: regionData?.stateId });
      const stateCode = stateData?.slug;
      const DbData = await Distributor.findOne({
        _id: req.body.distributorId,
      });
      const distributorCode = DbData?.dbCode;
      const outletCode = updatedOutlet?.outletCode;
      const plainPassword = "RT@" + outletCode;

      // using salt and hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(plainPassword, salt);

      updatedOutlet = await Outlet.findByIdAndUpdate(
        req.params.outletId,
        {
          ...req.body,
          approvedDate: new Date(),
          outletCode: outletCode,
        },
        { new: true }
      );

      existingOutlet = await OutletApproved.findOne({ outletCode: outletCode });

      if (existingOutlet) {
        return res.status(400).json({
          status: 400,
          message: "Outlet code already exists",
        });
      }

      const approvedOutlet = await OutletApproved.create({
        zoneId: regionData?.zoneId,
        regionId: DbData?.regionId,
        stateId: DbData?.stateId,
        distributorId: updatedOutlet?.distributorId,
        beatId: updatedOutlet?.beatId,
        outletCode: updatedOutlet?.outletCode,
        outletUID: updatedOutlet?.outletUID,
        outletName: updatedOutlet?.outletName,
        ownerName: updatedOutlet?.ownerName,
        address1: updatedOutlet?.address1,
        address2: updatedOutlet?.address2,
        marketCenter: updatedOutlet?.marketCenter,
        location: updatedOutlet?.location,
        city: updatedOutlet?.city,
        pin: updatedOutlet?.pin,
        district: updatedOutlet?.district,
        mobile1: updatedOutlet?.mobile1,
        password: hashedPassword,
        mobile2: updatedOutlet?.mobile2,
        teleCallingSlot: updatedOutlet?.teleCallingSlot,
        poiFrontImage: updatedOutlet?.poiFrontImage,
        poiBackImage: updatedOutlet?.poiBackImage,
        outletImage: updatedOutlet?.outletImage,
        poaFrontImage: updatedOutlet?.poaFrontImage,
        poaBackImage: updatedOutlet?.poaBackImage,
        enrollmentForm: updatedOutlet?.enrollmentForm,
        OutletSegments: updatedOutlet?.OutletSegments || "",
        categoryOfOutlet: updatedOutlet?.categoryOfOutlet || "",
        productCategory: updatedOutlet?.productCategory || "",
        sellingBrands: updatedOutlet?.sellingBrands,
        competitorBrands: updatedOutlet?.competitorBrands,
        existingRetailer: updatedOutlet?.existingRetailer,
        approvedDate: updatedOutlet?.approvedDate,
        outletSource: updatedOutlet?.outletSource,
        employeeId: updatedOutlet?.employeeId,
        createdFromLead: updatedOutlet?._id,
        aadharNumber: updatedOutlet?.aadharNumber,
        panNumber: updatedOutlet?.panNumber,
        gstin: updatedOutlet?.gstin,
        contactPerson: updatedOutlet?.contactPerson,
        email: updatedOutlet?.email,
        retailerClass: updatedOutlet?.retailerClass,
        enrolledstatus: updatedOutlet?.enrolledstatus,
        shiptoAddress: updatedOutlet?.shiptoAddress,
        shiptopincode: updatedOutlet?.shiptopincode,
      });

      await Outlet.findByIdAndUpdate(
        req.params.outletId,
        {
          outletApprovedId: approvedOutlet?._id,
        },
        { new: true }
      );
    } else {
      updatedOutlet = await Outlet.findByIdAndUpdate(
        req.params.outletId,
        req.body,
        { new: true }
      );
    }

    return res.status(200).json({
      status: 200,
      message: "Outlet updated successfully",
      data: updatedOutlet,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { statusUpdate };
