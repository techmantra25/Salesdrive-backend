const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

// Merge duplicate outlets with same mobile number
const mergeOutletsWithSameMobile = asyncHandler(async (req, res) => {
  try {
    const { mobileNumber } = req.body;

    if (!mobileNumber) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required in request body"
      });
    }

    // Find all outlets with the specified mobile number
    const outlets = await OutletApproved.find({
      $expr: {
        $eq: [{ $toString: "$mobile1" }, { $toString: { $literal: mobileNumber } }]
      }
    }).sort({ createdAt: -1 }); // Sort by newest first

    console.log(`Outlets with mobile number ${mobileNumber}:`, outlets);

    if (outlets.length <= 1) {
      return res.status(200).json({
        success: true,
        count: outlets.length,
        mobileNumber: mobileNumber,
        message: "No duplicates found to merge",
        data: outlets,
      });
    }

    // Check for outlets with non-zero current point balances
    const nonZeroBalanceOutlets = outlets.filter(outlet => outlet.currentPointBalance !== 0);

    // If there are 2 or more outlets with non-zero balances,
    // we should NOT deactivate those outlets with non-zero balances

    // Prepare fields to merge (excluding sourceData as per user's requirement)
    // Initialize these before determining main/other outlets since they're used in the condition
    let mainOutlet;
    let otherOutlets;

    // Initialize collections for deduplication
    const allReferenceIds = new Set();
    const allBeatIds = new Set();
    let mergedMassistRefIds = [];

    if (nonZeroBalanceOutlets.length >= 2) {
      // When there are 2 or more outlets with non-zero balances, pick the one with highest balance as main
      const outletWithHighestBalance = nonZeroBalanceOutlets.reduce((max, outlet) =>
        outlet.currentPointBalance > max.currentPointBalance ? outlet : max,
        nonZeroBalanceOutlets[0]
      );

      mainOutlet = outletWithHighestBalance;

      // Initialize collections with main outlet's data first
      mergedMassistRefIds = [...mainOutlet.massistRefIds || []];

      // Add referenceIds from main outlet
      if (mainOutlet.referenceId && Array.isArray(mainOutlet.referenceId)) {
        mainOutlet.referenceId.forEach(refId => {
          // Convert ObjectId to string for proper deduplication
          allReferenceIds.add(refId.toString());
        });
      }

      // Add beatIds from main outlet
      if (mainOutlet.beatId && Array.isArray(mainOutlet.beatId)) {
        mainOutlet.beatId.forEach(beatId => {
          // Convert ObjectId to string for proper deduplication
          allBeatIds.add(beatId.toString());
        });
      }

      // Outlets with zero balances should be marked as other outlets to be deactivated
      const zeroBalanceOutlets = outlets.filter(outlet =>
        outlet._id.toString() !== mainOutlet._id.toString() &&
        outlet.currentPointBalance === 0
      );

      // Also get other non-zero balance outlets to merge their data but not deactivate them
      const otherNonZeroBalanceOutlets = outlets.filter(outlet =>
        outlet._id.toString() !== mainOutlet._id.toString() &&
        outlet.currentPointBalance !== 0
      );

      // Only zero balance outlets are marked as other outlets to be deactivated
      otherOutlets = [...zeroBalanceOutlets];

      // We'll use otherNonZeroBalanceOutlets for data merging but they won't be deactivated
      console.log(`Found ${nonZeroBalanceOutlets.length} outlets with non-zero balances. Only zero-balance outlets will be deactivated.`);

      // Merge data from other non-zero balance outlets into the main outlet too
      if (otherNonZeroBalanceOutlets.length > 0) {
        otherNonZeroBalanceOutlets.forEach(outlet => {
          // Merge massistRefIds from other non-zero balance outlets too
          if (outlet.massistRefIds && Array.isArray(outlet.massistRefIds)) {
            outlet.massistRefIds.forEach(id => {
              if (!mergedMassistRefIds.includes(id)) {
                mergedMassistRefIds.push(id);
              }
            });
          }

          // Collect all beatIds from other non-zero balance outlets (for deduplication)
          if (outlet.beatId && Array.isArray(outlet.beatId)) {
            outlet.beatId.forEach(beatId => {
              // Convert ObjectId to string for proper deduplication
              allBeatIds.add(beatId.toString());
            });
          }

          // Collect all referenceIds from other non-zero balance outlets (for deduplication)
          if (outlet.referenceId && Array.isArray(outlet.referenceId)) {
            outlet.referenceId.forEach(refId => {
              // Convert ObjectId to string for proper deduplication
              allReferenceIds.add(refId.toString());
            });
          }
        });

        console.log(`Also merged data from ${otherNonZeroBalanceOutlets.length} additional non-zero balance outlets`);
      }
    } else if (nonZeroBalanceOutlets.length === 1) {
      // If only one outlet has non-zero balance, use the existing logic
      const nonZeroPointBalanceIndex = outlets.findIndex(outlet => outlet.currentPointBalance !== 0);

      if (nonZeroPointBalanceIndex !== -1) {
        // If there's an outlet with non-zero balance, make it the main outlet
        mainOutlet = outlets[nonZeroPointBalanceIndex];
        otherOutlets = [
          ...outlets.slice(0, nonZeroPointBalanceIndex),
          ...outlets.slice(nonZeroPointBalanceIndex + 1)
        ];
        console.log(`Outlet with non-zero point balance found and set as main outlet: ${mainOutlet._id}`);
      } else {
        // If no non-zero balance outlet, check for SFA outlet
        const sfaOutletIndex = outlets.findIndex(outlet => outlet.outletSource === "SFA");

        if (sfaOutletIndex !== -1) {
          // If there's an SFA outlet, make it the main outlet
          mainOutlet = outlets[sfaOutletIndex];
          otherOutlets = [
            ...outlets.slice(0, sfaOutletIndex),
            ...outlets.slice(sfaOutletIndex + 1)
          ];
          console.log(`SFA outlet found and set as main outlet: ${mainOutlet._id}`);
        } else {
          // If no SFA outlet, take the first (newest) as main outlet
          mainOutlet = outlets[0];
          otherOutlets = outlets.slice(1);
        }
      }

      // Initialize collections with main outlet's data
      mergedMassistRefIds = [...mainOutlet.massistRefIds || []];

      // Add referenceIds from main outlet
      if (mainOutlet.referenceId && Array.isArray(mainOutlet.referenceId)) {
        mainOutlet.referenceId.forEach(refId => {
          // Convert ObjectId to string for proper deduplication
          allReferenceIds.add(refId.toString());
        });
      }

      // Add beatIds from main outlet
      if (mainOutlet.beatId && Array.isArray(mainOutlet.beatId)) {
        mainOutlet.beatId.forEach(beatId => {
          // Convert ObjectId to string for proper deduplication
          allBeatIds.add(beatId.toString());
        });
      }
    } else {
      // If no outlets have non-zero balances, use the existing logic
      // If no non-zero balance outlet, check for SFA outlet
      const sfaOutletIndex = outlets.findIndex(outlet => outlet.outletSource === "SFA");

      if (sfaOutletIndex !== -1) {
        // If there's an SFA outlet, make it the main outlet
        mainOutlet = outlets[sfaOutletIndex];
        otherOutlets = [
          ...outlets.slice(0, sfaOutletIndex),
          ...outlets.slice(sfaOutletIndex + 1)
        ];
        console.log(`SFA outlet found and set as main outlet: ${mainOutlet._id}`);
      } else {
        // If no SFA outlet, take the first (newest) as main outlet
        mainOutlet = outlets[0];
        otherOutlets = outlets.slice(1);
      }

      // Initialize collections with main outlet's data
      mergedMassistRefIds = [...mainOutlet.massistRefIds || []];

      // Add referenceIds from main outlet
      if (mainOutlet.referenceId && Array.isArray(mainOutlet.referenceId)) {
        mainOutlet.referenceId.forEach(refId => {
          // Convert ObjectId to string for proper deduplication
          allReferenceIds.add(refId.toString());
        });
      }

      // Add beatIds from main outlet
      if (mainOutlet.beatId && Array.isArray(mainOutlet.beatId)) {
        mainOutlet.beatId.forEach(beatId => {
          // Convert ObjectId to string for proper deduplication
          allBeatIds.add(beatId.toString());
        });
      }
    }

    // Now process otherOutlets for data collection
    otherOutlets.forEach(outlet => {
      // Collect massistRefIds
      if (outlet.massistRefIds && Array.isArray(outlet.massistRefIds)) {
        outlet.massistRefIds.forEach(id => {
          if (!mergedMassistRefIds.includes(id)) {
            mergedMassistRefIds.push(id);
          }
        });
      }

      // Collect all beatIds from other outlets (for deduplication)
      if (outlet.beatId && Array.isArray(outlet.beatId)) {
        outlet.beatId.forEach(beatId => {
          // Convert ObjectId to string for proper deduplication
          allBeatIds.add(beatId.toString());
        });
      }

      // Collect all referenceIds from other outlets (for deduplication)
      if (outlet.referenceId && Array.isArray(outlet.referenceId)) {
        outlet.referenceId.forEach(refId => {
          // Convert ObjectId to string for proper deduplication
          allReferenceIds.add(refId.toString());
        });
      }
    });

    // Convert back to ObjectId arrays for saving to database
    const { ObjectId } = require('mongoose').Types;
    const mergedBeatIds = Array.from(allBeatIds).map(id => new ObjectId(id));
    const mergedReferenceIds = Array.from(allReferenceIds).map(id => new ObjectId(id));

    // Update the main outlet with merged data (excluding sourceData)
    const updatedMainOutlet = await OutletApproved.findByIdAndUpdate(
      mainOutlet._id,
      {
        $set: {
          massistRefIds: mergedMassistRefIds,
          beatId: mergedBeatIds,
          referenceId: mergedReferenceIds
        }
      },
      { new: true }
    );

    // Update other outlets to have status: false to hide them
    const updatePromises = otherOutlets.map(outlet =>
      OutletApproved.findByIdAndUpdate(
        outlet._id,
        { $set: { status: false } },
        { new: true }
      )
    );

    const hiddenOutlets = await Promise.all(updatePromises);

    // Find outlets with non-zero balances that were NOT deactivated (in the >=2 non-zero case)
    const nonZeroOutletsNotDeactivated = nonZeroBalanceOutlets.filter(outlet =>
      outlet._id.toString() !== mainOutlet._id.toString()
    );

    console.log(`Merged outlets for mobile number ${mobileNumber}. Main outlet updated:`, updatedMainOutlet._id);

    res.status(200).json({
      success: true,
      count: outlets.length,
      mobileNumber: mobileNumber,
      message: nonZeroBalanceOutlets.length >= 2
        ? `Successfully merged ${otherOutlets.length} zero-balance duplicate outlets into the main outlet. ${nonZeroBalanceOutlets.length - 1} non-zero balance outlets were preserved (not deactivated).`
        : `Successfully merged ${otherOutlets.length} duplicate outlets into the main outlet`,
      mainOutlet: updatedMainOutlet,
      hiddenOutlets: hiddenOutlets,
      preservedOutlets: nonZeroBalanceOutlets.length >= 2 ? nonZeroOutletsNotDeactivated : [],
      mergedData: {
        massistRefIds: mergedMassistRefIds,
        beatId: mergedBeatIds,
        referenceId: mergedReferenceIds
      }
    });
  } catch (error) {
    console.error("Error merging outlets by mobile number:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = {
  mergeOutletsWithSameMobile
};