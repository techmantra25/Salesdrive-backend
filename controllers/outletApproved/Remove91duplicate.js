const asyncHandler = require("express-async-handler");
const OutletApproved = require("../../models/outletApproved.model");

// Find outlets where phone number starts with +91
const findOutletsWithPlus91 = asyncHandler(async (req, res) => {
  try {
    // Find all outlets with mobile numbers starting with +91
    const outlets = await OutletApproved.find({
      $or: [
        { mobile1: { $regex: /^\+91/, $options: "i" } },
        { mobile2: { $regex: /^\+91/, $options: "i" } },
        { whatsappNumber: { $regex: /^\+91/, $options: "i" } }
      ]
    });

    if (outlets.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: "No outlets found with +91 prefix in mobile numbers"
      });
    }

    console.log(`Found ${outlets.length} outlets with +91 prefix`);

    // Return outlets with +91 prefixes
    res.status(200).json({
      success: true,
      count: outlets.length,
      message: `Found ${outlets.length} outlets with +91 prefix in mobile numbers`,
      outlets: outlets
    });
  } catch (error) {
    console.error("Error finding outlets with +91 prefixes:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Find outlet by ID and check if it has +91 prefix in phone numbers
const findOutletWithPlus91ById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const outlet = await OutletApproved.findById(id);

    if (!outlet) {
      return res.status(404).json({
        success: false,
        message: "Outlet not found"
      });
    }

    // Check if any mobile numbers have +91 prefix
    const hasPlus91Prefix = (
      (outlet.mobile1 && typeof outlet.mobile1 === 'string' && outlet.mobile1.startsWith('+91')) ||
      (outlet.mobile2 && typeof outlet.mobile2 === 'string' && outlet.mobile2.startsWith('+91')) ||
      (outlet.whatsappNumber && typeof outlet.whatsappNumber === 'string' && outlet.whatsappNumber.startsWith('+91'))
    );

    if (hasPlus91Prefix) {
      return res.status(200).json({
        success: true,
        hasPlus91Prefix: true,
        message: "Outlet has +91 prefix in one or more mobile numbers",
        outlet: outlet
      });
    } else {
      return res.status(200).json({
        success: true,
        hasPlus91Prefix: false,
        message: "No +91 prefix found in mobile numbers for this outlet",
        outlet: outlet
      });
    }
  } catch (error) {
    console.error("Error checking outlet for +91 prefix:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Find outlets with +91 prefixes and other outlets that share the same number (without +91)
const findOutletsWithPlus91AndDuplicates = asyncHandler(async (req, res) => {
  try {
    // Find all outlets with mobile numbers starting with +91
    const outletsWithPlus91 = await OutletApproved.find({
      $or: [
        { mobile1: { $regex: /^\+91/, $options: "i" } },
        { mobile2: { $regex: /^\+91/, $options: "i" } },
        { whatsappNumber: { $regex: /^\+91/, $options: "i" } }
      ]
    });

    if (outletsWithPlus91.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: "No outlets found with +91 prefix in mobile numbers"
      });
    }

    const results = [];

    for (const outlet of outletsWithPlus91) {
      const potentialMatches = [];

      // Check mobile1
      if (outlet.mobile1 && typeof outlet.mobile1 === 'string' && outlet.mobile1.startsWith('+91')) {
        const cleanNumber = outlet.mobile1.substring(3); // Remove +91 prefix

        const matchingOutlets = await OutletApproved.find({
          _id: { $ne: outlet._id }, // Exclude current outlet
          $or: [
            { mobile1: cleanNumber },
            { mobile2: cleanNumber },
            { whatsappNumber: cleanNumber }
          ]
        });

        if (matchingOutlets.length > 0) {
          potentialMatches.push({
            originalNumber: outlet.mobile1,
            cleanedNumber: cleanNumber,
            mobileField: 'mobile1',
            matchingOutlets: matchingOutlets
          });
        }
      }

      // Check mobile2
      if (outlet.mobile2 && typeof outlet.mobile2 === 'string' && outlet.mobile2.startsWith('+91')) {
        const cleanNumber = outlet.mobile2.substring(3); // Remove +91 prefix

        const matchingOutlets = await OutletApproved.find({
          _id: { $ne: outlet._id }, // Exclude current outlet
          $or: [
            { mobile1: cleanNumber },
            { mobile2: cleanNumber },
            { whatsappNumber: cleanNumber }
          ]
        });

        if (matchingOutlets.length > 0) {
          potentialMatches.push({
            originalNumber: outlet.mobile2,
            cleanedNumber: cleanNumber,
            mobileField: 'mobile2',
            matchingOutlets: matchingOutlets
          });
        }
      }

      // Check whatsappNumber
      if (outlet.whatsappNumber && typeof outlet.whatsappNumber === 'string' && outlet.whatsappNumber.startsWith('+91')) {
        const cleanNumber = outlet.whatsappNumber.substring(3); // Remove +91 prefix

        const matchingOutlets = await OutletApproved.find({
          _id: { $ne: outlet._id }, // Exclude current outlet
          $or: [
            { mobile1: cleanNumber },
            { mobile2: cleanNumber },
            { whatsappNumber: cleanNumber }
          ]
        });

        if (matchingOutlets.length > 0) {
          potentialMatches.push({
            originalNumber: outlet.whatsappNumber,
            cleanedNumber: cleanNumber,
            mobileField: 'whatsappNumber',
            matchingOutlets: matchingOutlets
          });
        }
      }

      if (potentialMatches.length > 0) {
        results.push({
          outletWithPlus91: outlet,
          potentialMatches: potentialMatches
        });
      }
    }

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        outletsWithPlus91: outletsWithPlus91,
        count: outletsWithPlus91.length,
        message: "Found outlets with +91 prefix, but no matching outlets without +91 prefix exist for the same numbers"
      });
    }

    res.status(200).json({
      success: true,
      count: results.length,
      message: `Found ${results.length} outlets with +91 that have duplicates without +91 prefix`,
      results: results
    });
  } catch (error) {
    console.error("Error finding outlets with +91 and duplicates:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Remove +91 prefix from all existing phone numbers in the database
const removeAllPlus91Prefixes = asyncHandler(async (req, res) => {
  try {
    // Find all outlets with mobile numbers starting with +91
    const outlets = await OutletApproved.find({
      $or: [
        { mobile1: { $regex: /^\+91/, $options: "i" } },
        { mobile2: { $regex: /^\+91/, $options: "i" } },
        { whatsappNumber: { $regex: /^\+91/, $options: "i" } }
      ]
    });

    if (outlets.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: "No outlets found with +91 prefix in mobile numbers"
      });
    }

    console.log(`Found ${outlets.length} outlets with +91 prefix`);

    let updatedCount = 0;
    const updateResults = [];

    // Process each outlet to remove +91 prefix
    for (const outlet of outlets) {
      let isUpdated = false;
      const updates = {};
      const changes = {};

      // Remove +91 from mobile1
      if (outlet.mobile1 && typeof outlet.mobile1 === 'string' && outlet.mobile1.startsWith('+91')) {
        const oldNumber = outlet.mobile1;
        const newNumber = outlet.mobile1.substring(3); // Remove first 3 characters (+91)
        updates.mobile1 = newNumber;
        changes.mobile1 = { old: oldNumber, new: newNumber };
        isUpdated = true;
      }

      // Remove +91 from mobile2
      if (outlet.mobile2 && typeof outlet.mobile2 === 'string' && outlet.mobile2.startsWith('+91')) {
        const oldNumber = outlet.mobile2;
        const newNumber = outlet.mobile2.substring(3); // Remove first 3 characters (+91)
        updates.mobile2 = newNumber;
        changes.mobile2 = { old: oldNumber, new: newNumber };
        isUpdated = true;
      }

      // Remove +91 from whatsappNumber
      if (outlet.whatsappNumber && typeof outlet.whatsappNumber === 'string' && outlet.whatsappNumber.startsWith('+91')) {
        const oldNumber = outlet.whatsappNumber;
        const newNumber = outlet.whatsappNumber.substring(3); // Remove first 3 characters (+91)
        updates.whatsappNumber = newNumber;
        changes.whatsappNumber = { old: oldNumber, new: newNumber };
        isUpdated = true;
      }

      if (isUpdated) {
        await OutletApproved.findByIdAndUpdate(outlet._id, { $set: updates });
        updatedCount++;
        updateResults.push({
          outletId: outlet._id,
          outletCode: outlet.outletCode,
          changes: changes
        });
        console.log(`Updated outlet ${outlet.outletCode}: removed +91 prefix from mobile numbers`);
      }
    }

    res.status(200).json({
      success: true,
      count: outlets.length,
      updatedCount: updatedCount,
      message: `Successfully processed ${updatedCount} outlets by removing +91 prefix from mobile numbers`,
      updateResults: updateResults
    });
  } catch (error) {
    console.error("Error removing +91 prefixes:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = {
  findOutletsWithPlus91,
  findOutletWithPlus91ById,
  findOutletsWithPlus91AndDuplicates,
  removeAllPlus91Prefixes
};