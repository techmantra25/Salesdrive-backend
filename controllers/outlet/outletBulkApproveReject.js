const asyncHandler = require("express-async-handler");
const Outlet = require("../../models/outlet.model");
const Employee = require("../../models/employee.model");
const { outletImpCode, generateUniversalOutletUID } = require("../../utils/codeGenerator");
const State = require("../../models/state.model");
const Region = require("../../models/region.model");
const Distributor = require("../../models/distributor.model");
const OutletApproved = require("../../models/outletApproved.model");
const OutletApprovedSource = require("../../models/outletApprovedSource.model");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const outletBulkApproveReject = async (req, res) => {
  try {
    const { outletIds, status } = req.body;

    // Input validation
    if (
      !outletIds ||
      !Array.isArray(outletIds) ||
      outletIds.length === 0 ||
      !status
    ) {
      return res.status(400).json({ message: "Missing or invalid parameters" });
    }

    // Fetch matching outlets
    const outlets = await Outlet.find({ _id: { $in: outletIds } });
    console.log(outlets);

    if (!outlets.length) {
      return res.status(404).json({ message: "No matching outlets found" });
    }

    // Extract mobile1 numbers from outlets for batch duplicate checking
    const mobile1sFromOutlets = outlets
      .map(outlet => outlet.mobile1)
      .filter(mobile => mobile && mobile.trim());

    // Fetch existing mobile1 numbers in approved outlets
    let existingMobile1s = [];
    if (mobile1sFromOutlets.length > 0) {
      const existingApprovedOutlets = await OutletApproved.find({
        mobile1: { $in: mobile1sFromOutlets }
      }).select("mobile1 _id").lean();
      existingMobile1s = existingApprovedOutlets.map(outlet => outlet.mobile1);
    }

    // // Bulk update outletStatus
    // await Outlet.updateMany(
    //   { _id: { $in: outletIds } },
    //   { $set: { outletStatus: status } }
    // );

    const skippedOutlets = [];
    const batchMobile1s = new Set(); // Track mobile1 numbers within current batch

    if (status === "Approved") {
      // Apply 10-digit mobile number validation (Indian mobile numbers: 6-9 followed by 9 digits)
      const mobileRegex = /^[6-9]\d{9}$/;

      for (const outlet of outlets) {
        // Validate mobile number format before processing
        if (outlet.mobile1 && outlet.mobile1.trim()) {
          if (!mobileRegex.test(outlet.mobile1)) {
            skippedOutlets.push({
              outletId: outlet._id,
              outletCode: outlet.outletCode,
              reason: `Invalid mobile number format: ${outlet.mobile1}. Must be a valid 10-digit Indian mobile number starting with 6-9`,
            });
            continue;
          }

          // Check if phone number already exists in approved outlets (database check)
          if (existingMobile1s.includes(outlet.mobile1)) {
            skippedOutlets.push({
              outletId: outlet._id,
              outletCode: outlet.outletCode,
              reason: `Mobile number ${outlet.mobile1} already exists in approved outlets`,
            });
            continue;
          }

          // Check for duplicate mobile1 within the same batch
          if (batchMobile1s.has(outlet.mobile1)) {
            skippedOutlets.push({
              outletId: outlet._id,
              outletCode: outlet.outletCode,
              reason: `Duplicate mobile number ${outlet.mobile1} within current batch`,
            });
            continue;
          }

          // Add mobile1 to batch tracking set for future checks
          batchMobile1s.add(outlet.mobile1);
        }

        // Check if outlet code already exists (keep existing logic)
        const existingApproved = await OutletApproved.findOne({
          outletCode: outlet.outletCode,
        });

        if (existingApproved) {
          skippedOutlets.push({
            outletId: outlet._id,
            outletCode: outlet.outletCode,
            reason: "Already approved",
          });
          continue;
        }

        // Generate system codes like in external sync
        const outletCode = outlet.outletCode.toString();
        const outletUID = await generateUniversalOutletUID();

        const plainPassword = "RT@" + outletCode;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(plainPassword, salt);

        // Create source data document for the approved outlet
        const sourceDataDoc = new OutletApprovedSource({
          sourceData: [outlet]
        });
        await sourceDataDoc.save();

        const approvedOutlet = await OutletApproved.create({
          zsm: outlet.zsm,
          rsm: outlet.rsm,
          asm: outlet.asm,
          createdBy: outlet.createdBy,
          createdBy_type: outlet.createdBy_type,
          employeeId: outlet.employeeId,
          zoneId: outlet.zoneId,
          regionId: outlet.regionId,
          stateId: outlet.stateId,
          distributorId: outlet.distributorId,
          beatId: outlet.beatId,
          outletCode: outletCode,
          outletUID: outletUID,
          outletName: outlet.outletName,
          ownerName: outlet.ownerName,
          address1: outlet.address1,
          address2: outlet.address2,
          marketCenter: outlet.marketCenter,
          location: outlet.location,
          city: outlet.city,
          pin: outlet.pin,
          district: outlet.district,
          mobile1: outlet.mobile1,
          mobile2: outlet.mobile2,
          whatsappNumber: outlet.whatsappNumber,
          teleCallingSlot: outlet.teleCallingSlot,
          poiFrontImage: outlet.poiFrontImage,
          poiBackImage: outlet.poiBackImage,
          outletImage: outlet.outletImage,
          poaFrontImage: outlet.poaFrontImage,
          poaBackImage: outlet.poaBackImage,
          enrollmentForm: outlet.enrollmentForm,
          categoryOfOutlet: outlet.categoryOfOutlet,
          sellingBrands: outlet.sellingBrands,
          competitorBrands: outlet.competitorBrands,
          existingRetailer: outlet.existingRetailer,
          approvedDate: new Date(),
          outletSource: outlet.outletSource,
          createdFromLead: outlet._id,
          referenceId: [outlet._id], // Store reference to the pending outlet
          sourceData: sourceDataDoc._id, // Store source data reference
          massistRefIds: [outlet.outletCode], // Store outlet code reference
          aadharNumber: outlet.aadharNumber,
          panNumber: outlet.panNumber,
          gstin: outlet.gstin,
          contactPerson: outlet.contactPerson,
          email: outlet.email,
          retailerClass: outlet.retailerClass,
          enrolledStatus: outlet.enrolledStatus,
          shipToAddress: outlet.shipToAddress,
          shipToPincode: outlet.shipToPincode,
          password: hashedPassword,
        });

        await Outlet.findByIdAndUpdate(outlet._id, {
          approvedDate: new Date(),
          outletApprovedId: approvedOutlet._id,
          outletStatus: status,
        });
      }
    }

    if (status === "Rejected") {
      // Delete the outlets instead of just updating their status
      await Outlet.deleteMany({ _id: { $in: outletIds } });
    }

    return res.status(200).json({
      status: 200,
      message: status === "Rejected"
        ? `Outlet(s) deleted successfully`
        : `Outlet(s) updated successfully with status '${status}'`,
      data: {
        totalProcessed: outletIds.length,
        totalSkipped: skippedOutlets.length,
        skippedOutlets,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
};

module.exports = { outletBulkApproveReject };