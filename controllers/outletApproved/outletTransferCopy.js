const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");
const { outletImpCode } = require("../../utils/codeGenerator");
const Distributor = require("../../models/distributor.model");

const outletTransferCopy = asyncHandler(async (req, res) => {
  try {
    const { outletType, referenceId, distributorId, beatId, transfertype } =
      req.body;

    let outletData;

    if (outletType === "transfer") {
      if (transfertype === "DB_TO_DB") {
        // Find the reference outlets by referenceId
        const referenceOutlets = await OutletApproved.find({
          _id: { $in: referenceId },
        });

        const distributorData = await Distributor.findOne({
          _id: distributorId,
        });

        // Create new outlets by copying details from the reference outlets
        const newOutlets = await Promise.all(
          referenceOutlets.map(async (outlet) => {
            const outletCode = await outletImpCode(distributorData?.dbCode); // Generate outletCode based on distributorId
            return {
              zoneId: outlet.zoneId,
              stateId: outlet.stateId,
              regionId: outlet.regionId,
              distributorId: distributorId,
              beatId: beatId,
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
              teleCallingSlot: outlet.teleCallingSlot,
              poiFrontImage: outlet.poiFrontImage,
              poiBackImage: outlet.poiBackImage,
              outletImage: outlet.outletImage,
              poaFrontImage: outlet.poaFrontImage,
              poaBackImage: outlet.poaBackImage,
              enrollmentForm: outlet.enrollmentForm,
              categoryOfOutlet: outlet.categoryOfOutlet,
              productCategory: outlet.productCategory,
              sellingBrands: outlet.sellingBrands,
              competitorBrands: outlet.competitorBrands,
              existingRetailer: outlet.existingRetailer,
              outletSource: outlet.outletSource,
              OutletsubBrands: outlet.OutletsubBrands,
              createdFromLead: outlet._id,
              outletType: "transfer",
              referenceId: [outlet._id], // Reference the original outlet
              transfertype: transfertype,
              outletCode, // Set the newly generated outletCode
              outletUID: outlet.outletUID, // Retain the existing outletUID or generate a new one if necessary
              status: true, // or use the original outlet's status
            };
          })
        );

        // Insert the new outlets into the database
        outletData = await OutletApproved.insertMany(newOutlets);

        // and deactivate those previous outlets
        outletData = await OutletApproved.updateMany(
          { _id: { $in: referenceId } },
          { status: false },
          { new: true }
        );
      } else if (transfertype === "BEAT_To_BEAT") {
        // Update the beatId and transfertype of the existing outlets
        outletData = await OutletApproved.updateMany(
          { _id: { $in: referenceId } },
          {
            $set: {
              beatId: beatId,
              transfertype: transfertype, // Update transfertype in the database
            },
          }
        );
      }
    } else {
      const referenceOutlets = await OutletApproved.find({
        _id: { $in: referenceId },
      });

      const distributorData = await Distributor.findOne({
        _id: distributorId,
      });

      // Create new outlets by copying details from the reference outlets
      const newOutlets = await Promise.all(
        referenceOutlets.map(async (outlet) => {
          const outletCode = await outletImpCode(distributorData?.dbCode); // Generate outletCode based on distributorId
          return {
            zoneId: outlet.zoneId,
            stateId: outlet.stateId,
            regionId: outlet.regionId,
            distributorId: distributorId,
            beatId: beatId,
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
            teleCallingSlot: outlet.teleCallingSlot,
            poiFrontImage: outlet.poiFrontImage,
            poiBackImage: outlet.poiBackImage,
            outletImage: outlet.outletImage,
            poaFrontImage: outlet.poaFrontImage,
            poaBackImage: outlet.poaBackImage,
            enrollmentForm: outlet.enrollmentForm,
            categoryOfOutlet: outlet.categoryOfOutlet,
            productCategory: outlet.productCategory,
            sellingBrands: outlet.sellingBrands,
            competitorBrands: outlet.competitorBrands,
            existingRetailer: outlet.existingRetailer,
            outletSource: outlet.outletSource,
            OutletsubBrands: outlet.OutletsubBrands,
            createdFromLead: outlet._id,
            outletType: outletType,
            referenceId: [outlet._id], // Reference the original outlet
            outletCode, // Set the newly generated outletCode
            outletUID: outlet.outletUID, // Retain the existing outletUID or generate a new one if necessary
            status: true, // or use the original outlet's status
          };
        })
      );
      // and deactivate those previous outlets

      // Insert the new outlets into the database
      outletData = await OutletApproved.insertMany(newOutlets);
    }

    return res.status(200).json({
      status: 200,
      message: "Outlet details updated successfully",
      data: outletData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  outletTransferCopy,
};
