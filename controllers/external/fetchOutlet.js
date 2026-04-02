const asyncHandler = require("express-async-handler");
const { RUPA_USERNAME, RUPA_PASSWORD } = require("../../config/server.config");
const axios = require("axios");
const qs = require("qs");
const Beat = require("../../models/beat.model");
const Employee = require("../../models/employee.model");
const OutletApproved = require("../../models/outletApproved.model");
const OutletApprovedSource = require("../../models/outletApprovedSource.model");
const State = require("../../models/state.model");
const Brand = require("../../models/brand.model");
const { acquireLock, releaseLock } = require("../../models/lock.model");
const {
  outletImpCode,
  generateUniversalOutletUID,
} = require("../../utils/codeGenerator");

const mobileRegex = /^[6-9]\d{9}$/;

// Helper function to clean phone numbers by removing +91 prefix
const cleanPhoneNumber = (phone) => {
  if (!phone) return phone;
  // Remove +91 prefix and any spaces or hyphens
  return phone
    .toString()
    .replace(/^\+91[\-\s]?/, "")
    .replace(/[\s\-\(\)]/g, "");
};

const fetchOutlet = asyncHandler(async (req, res) => {
  console.log("Fetching outlets...");

  if (!(await acquireLock("syncOutletMaster"))) {
    console.log(
      "syncOutletMaster: Lock not acquired, another sync in progress"
    );
    res.status(400);
    throw new Error("Another sync is in progress. Please try again later.");
  }
  console.log("✅ [syncOutletMaster] Lock acquired.");

  try {
    // get the end data in mm/dd/yyyy format
    let EndDate = new Date();
    EndDate = EndDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // get the start date in mm/dd/yyyy format
    let StartDate = new Date();
    StartDate.setDate(StartDate.getDate() - 90); // 90 days before today
    StartDate = StartDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    if (req.query.startDate && req.query.endDate) {
      // check if startDate and endDate are provided in the query is valid date
      const startDate = new Date(req.query.startDate);
      const endDate = new Date(req.query.endDate);
      if (isNaN(startDate) || isNaN(endDate)) {
        return res.status(400).json({
          error: true,
          message: "Invalid startDate or endDate format. Use mm/dd/yyyy.",
        });
      } else if (startDate > endDate) {
        return res.status(400).json({
          error: true,
          message: "startDate cannot be greater than endDate.",
        });
      } else {
        StartDate = startDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        EndDate = endDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
      }
    }

    // Step 1: Get auth token
    const tokenResponse = await axios({
      method: "post",
      url: "https://api.massistcrm.com/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: qs.stringify({
        username: RUPA_USERNAME,
        grant_type: "password",
        password: RUPA_PASSWORD,
      }),
    });

    console.log("Token fetched successfully");

    const token = tokenResponse.data.access_token;

    console.log("Token fetched successfully", token);

    console.log("calling the Order SKU Report API...");
    console.log("StartDate:", StartDate);
    console.log("EndDate:", EndDate);

    //Step 2: Call the Order SKU Report API
    const reportResponse = await axios({
      method: "post",
      url: "https://api.massistcrm.com/api/v2/employee/GetCompanyRetailerMaster",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        DataFilter: "Counting",
        ClientType: "",
        filter: 3,
        StartDate: `${StartDate}`,
        EndDate: `${EndDate}`,
        ExtraFilter1: "",
      },
    });

    const outlets = reportResponse?.data?.AllData || [];

    console.log("Outlets fetched successfully");

    if (!outlets || outlets.length === 0) {
      return res.status(404).json({
        error: true,
        message: "No outlets found for the given date range.",
      });
    }

    // Step 3: Filter the data
    const beats = await Beat.find({
      status: true,
    });
    const beatIds = beats.reduce((acc, beat) => {
      if (!beat.beatIds || beat.beatIds.length === 0) {
        return acc;
      } else {
        return acc.concat(beat.beatIds);
      }
    }, []);

    const employees = await Employee.find({
      status: true,
    });
    const empIds = employees.map((emp) => emp.empId);

    // sample response data
    // {
    //         "IncrementId": 306297,
    //         "pId": 257,
    //         "Emp_Id": 306297,
    //         "Client_Id": 32951959,
    //         "IsECO": true,
    //         "IsREC": true,
    //         "Emp_Name": "Kundan Kumar Jha",
    //         "SO_Name": "",
    //         "Label": "EU433",
    //         "EmpPhone": "9308093132",
    //         "Designation": "SO",
    //         "Division": "Euro",
    //         "TLName": "Kumar Manoj",
    //         "TLPhone": "9931371480",
    //         "AddState": "Bihar",
    //         "AddCity": "Patna",
    //         "Client_Name": "Hari Darshan",
    //         "Phone1": "9835012046",
    //         "Client_Type": "Retailer-Rupa",
    //         "Function": "",
    //         "Beats": "Patna ",
    //         "BeatId": "609509",
    //         "ClientSource": "DEEPAK HOSIERY",
    //         "ClientSourceCode": "DPTJ0822",
    //         "ClientSourcePhone": "9570611342",
    //         "ClientSourceType": "Distributor",
    //         "CreatedBy": "Kundan Kumar Jha",
    //         "LastOrderDate": "01-07-2025",
    //         "Varified": "Waiting for approval..",
    //         "FullAddress": "Ram Krishna Nagar,Patna,Bihar,INDIA",
    //         "CommunicationSkills": "",
    //         "Email_Address": "",
    //         "BNPBRange": "B",
    //         "ListOfBrandsSells": "Weekly",
    //         "Rating": 0,
    //         "Degree": "",
    //         "Info3": "",
    //         "CDate": "01/07/25"
    //     }

    // Needed Data
    //     {
    //   "outletCode": "(Required)", // Client_Id
    //   "outletUid": "(Required)", // Client_Id
    //   "outletName": "(Required)", // Client_Name
    //   "ownerName": "(Required)", // Client_Name
    //   "employeeCode": "(Required)", // Label
    //   "beatCode": "(Required)", // BeatId
    //   "stateCode": "(Required) [Example: WB]", // AddState
    //   "brandCode": "(Optional) [Example: BRAND001, BRAND002]",
    //   "mobile1": "(Optional)", // Phone1
    //   "mobile2": "(Optional)",
    //   "whatsappNumber": "(Optional)",
    //   "pin": "(Optional)",
    //   "preferredLanguage": "(Optional)",
    //   "teleCallDay": "(Optional)",
    //   "address1": "(Optional)", // FullAddress
    //   "address2": "(Optional)",
    //   "marketCenter": "(Optional)",
    //   "city": "(Optional)", // AddCity
    //   "aadharNumber": "(Optional)",
    //   "panNumber": "(Optional)",
    //   "gstin": "(Optional)",
    //   "location": "(Optional)",
    //   "gpsLocation": "(Optional)",
    //   "categoryOfOutlet": "(Optional)",
    //   "existingRetailer": "(Optional) [Valid: TRUE, FALSE]",
    //   "contactPerson": "(Optional)",
    //   "email": "(Optional)",
    //   "retailerClass": "(Optional) [Valid: 'Economy', 'Premium', 'RETAILER']",
    //   "enrolledStatus": "(Optional) [Valid: 'ENROLLED', 'NOT ENROLLED']",
    //   "shipToAddress": "(Optional)", // FullAddress
    //   "shipToPincode": "(Optional)"
    // }

    const requiredFields = [
      "Client_Id",
      "Client_Name",
      "Label",
      "BeatId",
      "AddState",
    ];

    let resp = [];
    let validRows = [...outlets];
    let skippedRows = [];

    console.log(
      "Valid Row Length after employee/beat filtering:",
      validRows.length
    );
    console.log(
      "Skipped Row Length after employee/beat filtering:",
      skippedRows.length
    );

    // Define phone number validation regex (for Indian numbers: 10 digits, with optional +91, 0, or 91 prefix)
    const phoneRegex = /^(\+91[\-\s]?)?[0]?(91)?[6789]\d{9}$/;

    // Filter out rows that do not have the required fields
    validRows = validRows.filter((row) => {
      if (
        !row.Client_Id ||
        !row.Client_Name ||
        !row.Label ||
        !row.BeatId ||
        !row.AddState
      ) {
        let reason = `Invalid data for outlet`;
        const missingFields = requiredFields.filter((field) => !row[field]);
        if (missingFields.length > 0) {
          reason += `, Missing fields: ${missingFields.join(", ")}`;
        }
        skippedRows.push({
          ...row,
          reason,
        });

        return false;
      } else {
        // Check if Phone1 exists and is valid
        if (row.Phone1) {
          // Clean the phone number by removing +91 prefix and other formatting characters
          const cleanPhone = cleanPhoneNumber(row.Phone1);
          if (!phoneRegex.test(cleanPhone)) {
            skippedRows.push({
              ...row,
              reason: `Invalid phone number format: ${row.Phone1}`,
            });
            return false;
          }
        }

        return true;
      }
    });

    console.log("Valid Row Length:", validRows.length);
    console.log("Skipped Row Length:", validRows.length);

    // filter out rows who's BeatId is not in the beatIds array or Label is not in the empIds array
    validRows = validRows.filter((row) => {
      if (!beatIds.includes(row.BeatId) || !empIds.includes(row.Label)) {
        let reason = `Invalid data for outlet`;
        if (!beatIds.includes(row.BeatId)) {
          reason += `, Invalid BeatId: ${row.BeatId}`;
        }
        if (!empIds.includes(row.Label)) {
          reason += `, Invalid Employee Code: ${row.Label}`;
        }
        skippedRows.push({
          ...row,
          reason,
        });
        return false;
      } else {
        return true;
      }
    });

    console.log(
      "Valid Row Length after employee/beat filtering:",
      validRows.length
    );
    console.log(
      "Skipped Row Length after employee/beat filtering:",
      skippedRows.length
    );

    // Group outlets by phone number to handle duplicates
    // Apply 10-digit mobile number validation (Indian mobile numbers: 6-9 followed by 9 digits)
    const phoneNumberGroups = {};
    validRows.forEach((row, index) => {
      // Validate mobile number format
      const rawPhone = row.Phone1;
      const cleanedPhone = rawPhone ? cleanPhoneNumber(rawPhone) : null;
      if (cleanedPhone && mobileRegex.test(cleanedPhone)) {
        if (!phoneNumberGroups[cleanedPhone]) {
          phoneNumberGroups[cleanedPhone] = [];
        }
        phoneNumberGroups[cleanedPhone].push({ row, index });
      } else {
        skippedRows.push({
          ...row,
          reason: `Invalid mobile number format: ${rawPhone}. Must be a valid 10-digit Indian mobile number starting with 6-9 at row ${index}`,
        });
      }
    });

    // Check for existing outlets by phone number
    const allPhoneNumbers = Object.keys(phoneNumberGroups).filter(
      (phone) => phone
    );
    const existingOutletsByPhone =
      (await OutletApproved.find({
        mobile1: { $in: allPhoneNumbers },
      }).lean()) || [];

    console.log(
      "Existing outlets with same phone numbers:",
      existingOutletsByPhone.length
    );

    // Process each phone number group
    let processedRows = [];
    let outletUpdates = [];

    for (const [phoneNumber, rows] of Object.entries(phoneNumberGroups)) {
      const existingOutlet = existingOutletsByPhone.find(
        (outlet) => outlet.mobile1 === phoneNumber
      );

      if (existingOutlet) {
        // Update existing outlet with additional source data and client IDs
        const allClientIds = rows.map((r) => r.row.Client_Id.toString());
        const allSourceData = rows.map((r) => r.row);

        outletUpdates.push({
          outletId: existingOutlet._id,
          clientIds: allClientIds,
          sourceData: allSourceData,
        });

        console.log(
          `Will update existing outlet for phone ${phoneNumber} with ${rows.length} additional records`
        );
      } else {
        // Create new outlet with all data from this phone number group
        const firstRow = rows[0].row;
        const allClientIds = rows.map((r) => r.row.Client_Id.toString());
        const allSourceData = rows.map((r) => r.row);

        // Create a combined row with all source data
        const combinedRow = {
          ...firstRow,
          massistRefIds: allClientIds,
          sourceDataArray: allSourceData,
        };
        processedRows.push(combinedRow);

        console.log(
          `Will create new outlet for phone ${phoneNumber} with ${rows.length} combined records`
        );
      }
    }

    // Update existing outlets with additional data
    if (outletUpdates.length > 0) {
      for (const update of outletUpdates) {
        try {
          // Create a new source document for the additional data
          const sourceDataDoc = new OutletApprovedSource({
            sourceData: update.sourceData,
          });
          await sourceDataDoc.save();

          await OutletApproved.findByIdAndUpdate(update.outletId, {
            $push: {
              massistRefIds: { $each: update.clientIds },
            },
            sourceData: sourceDataDoc._id, // Store ObjectId reference to source document
          });
          console.log(
            `Updated outlet ${update.outletId} with ${update.clientIds.length} additional client IDs and source data`
          );
        } catch (error) {
          console.error(`Error updating outlet ${update.outletId}:`, error);
        }
      }
    }

    // Use processedRows as our valid rows for insertion
    validRows = processedRows;

    console.log(
      "Valid Row Length after phone number processing:",
      validRows.length
    );
    console.log(
      "Phone number groups processed:",
      Object.keys(phoneNumberGroups).length
    );
    console.log("Outlet updates planned:", outletUpdates.length);

    // Check for existing outlets with same phone numbers
    const newPhoneNumbers = validRows
      .filter((row) => row.Phone1)
      .map((row) => cleanPhoneNumber(row.Phone1));

    if (newPhoneNumbers.length > 0) {
      const existingOutletsWithSamePhone = await OutletApproved.find({
        mobile1: { $in: newPhoneNumbers },
      })
        .select("mobile1 outletName")
        .lean();

      if (existingOutletsWithSamePhone.length > 0) {
        const existingPhoneNumbers = existingOutletsWithSamePhone.map(
          (outlet) => outlet.mobile1
        );

        validRows = validRows.filter((row) => {
          const cleanedPhone = row.Phone1 ? cleanPhoneNumber(row.Phone1) : null;
          const hasExistingPhone =
            cleanedPhone && existingPhoneNumbers.includes(cleanedPhone);

          if (hasExistingPhone) {
            skippedRows.push({
              ...row,
              reason: `Outlet already exists in the database with phone number: ${row.Phone1}`,
            });
            return false;
          }
          return true;
        });
      }
    }

    console.log("Valid Row Length:", validRows.length);
    console.log("Skipped Row Length:", skippedRows.length);

    // Get required reference data for validation and mapping
    const [statesData, employeesData, beatsData, brandsData] =
      await Promise.all([
        State.find({ status: true }).select("name slug _id").lean(),
        Employee.find({ status: true }).select("empId _id").lean(),
        Beat.find({ status: true }).select("beatIds _id").lean(),
        Brand.find({ status: true }).select("_id").lean(),
      ]);

    // Create lookup maps for quick reference
    const stateMap = new Map(
      statesData.map((state) => [state.name, state._id])
    );
    const employeeMap = new Map(
      employeesData.map((emp) => [emp.empId, emp._id])
    );
    const beatMap = new Map();
    beatsData.forEach((beat) => {
      if (beat.beatIds && Array.isArray(beat.beatIds)) {
        beat.beatIds.forEach((beatId) => {
          beatMap.set(beatId, beat._id);
        });
      }
    });

    // Transform and validate the data
    let validOutletsForDB = [];

    for (const row of validRows) {
      try {
        // Get required IDs
        const stateId = stateMap.get(row.AddState);
        const employeeId = employeeMap.get(row.Label);
        const beatId = beatMap.get(row.BeatId);

        if (!stateId || !employeeId || !beatId) {
          skippedRows.push({
            ...row,
            reason: `Missing required references - State: ${
              !stateId ? "not found" : "found"
            }, Employee: ${!employeeId ? "not found" : "found"}, Beat: ${
              !beatId ? "not found" : "found"
            }`,
          });
          continue;
        }

        // Create source data document first
        const sourceDataDoc = new OutletApprovedSource({
          sourceData: row.sourceDataArray || [row],
        });
        await sourceDataDoc.save();

        // Apply 10-digit mobile number validation before creating outlet
        const rawMobileNumber = row.Phone1;
        const cleanedMobileNumber = rawMobileNumber
          ? cleanPhoneNumber(rawMobileNumber)
          : null;
        const mobileNumber =
          cleanedMobileNumber && mobileRegex.test(cleanedMobileNumber)
            ? cleanedMobileNumber
            : "";

        // Skip this outlet if mobile number is invalid
        if (!mobileNumber) {
          skippedRows.push({
            ...row,
            reason: `Invalid mobile number format: ${row.Phone1}. Must be a valid 10-digit Indian mobile number starting with 6-9`,
          });
          continue;
        }

        // Validate Aadhar number (12 digits)
        const aadharNumber = row.AadharNumber?.toString().trim();
        if (aadharNumber && aadharNumber !== "N/A") {
          const aadharRegex = /^\d{12}$/;
          if (!aadharRegex.test(aadharNumber)) {
            skippedRows.push({
              ...row,
              reason: `Invalid Aadhaar number format: ${aadharNumber}. Must be a 12-digit number`,
            });
            continue;
          }
        }

        // Validate PAN number (5 letters + 4 digits + 1 letter)
        const panNumber = row.PANNumber?.toString().trim();
        if (panNumber && panNumber !== "N/A") {
          const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
          if (!panRegex.test(panNumber)) {
            skippedRows.push({
              ...row,
              reason: `Invalid PAN number format: ${panNumber}. Must be in format ABCDE1234F`,
            });
            continue;
          }
        }

        // Validate GSTIN (15 character format)
        const gstin = row.GSTIN?.toString().trim();
        if (gstin && gstin !== "N/A") {
          const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/i;
          if (!gstinRegex.test(gstin)) {
            skippedRows.push({
              ...row,
              reason: `Invalid GSTIN format: ${gstin}. Must be in valid 15-character GSTIN format`,
            });
            continue;
          }
        }

        // Create outlet document with system-generated codes
        const outletCode = row.Client_Id.toString(); // Use Client_Id directly as outletCode
        const outletUID = await generateUniversalOutletUID(); // Generate system UID
        const outletDoc = {
          outletCode: outletCode,
          outletUID: outletUID,
          outletName: row.Client_Name,
          ownerName: row.Client_Name,
          employeeId: employeeId,
          beatId: [beatId], // Convert single ObjectId to array as per model schema
          stateId: stateId,
          mobile1: mobileNumber,
          address1: row.FullAddress || "",
          city: row.AddCity || "",
          email: row.Email_Address || "",
          categoryOfOutlet: "RETAILER",
          retailerClass: "A",
          enrolledStatus: "ENROLLED",
          shipToAddress: row.FullAddress || "",
          outletSource: "SFA",
          sourceData: sourceDataDoc._id, // Store ObjectId reference to source document
          massistRefIds: row.massistRefIds || [row.Client_Id.toString()], // Track all client IDs
          status: true,
        };

        validOutletsForDB.push(outletDoc);
      } catch (error) {
        console.error(`Error processing row ${row.Client_Id}:`, error);
        skippedRows.push({
          ...row,
          reason: `Processing error: ${error.message}`,
        });
      }
    }

    console.log("Valid outlets for DB insertion:", validOutletsForDB);

    // Group outlets by phone number and keep only the first entry for each phone number
    const phoneGroupedOutlets = new Map();

    validOutletsForDB.forEach((outlet) => {
      const phoneKey = outlet.mobile1;
      if (phoneKey && !phoneGroupedOutlets.has(phoneKey)) {
        // Only add the outlet if this phone number hasn't been seen before
        phoneGroupedOutlets.set(phoneKey, outlet);
      }
    });

    // Convert back to array with deduplicated outlets
    validOutletsForDB = Array.from(phoneGroupedOutlets.values());

    console.log(
      "Deduplicated outlets for DB insertion:",
      validOutletsForDB?.length
    );

    // Insert outlets into database if any valid outlets exist
    let insertedOutlets = [];
    if (validOutletsForDB.length > 0) {
      try {
        // Log the first outlet document for debugging
        console.log(
          "Sample outlet document to be inserted:",
          JSON.stringify(validOutletsForDB[0], null, 2)
        );

        insertedOutlets = await OutletApproved.insertMany(validOutletsForDB, {
          ordered: false, // Continue inserting even if some fail
        });
        console.log(
          `Successfully inserted ${insertedOutlets.length} new outlets (with combined duplicate phone data)`
        );
        console.log(
          `Updated ${outletUpdates.length} existing outlets with additional source data and client IDs`
        );
      } catch (error) {
        console.error("Error inserting outlets:", error);
        console.error("Error details:", error.errors); // Log validation errors

        // Handle duplicate key errors and other insertion errors
        if (error.code === 11000) {
          console.log(
            "Some outlets already exist, continuing with successful insertions"
          );
          insertedOutlets = error.result?.insertedDocs || [];
        } else if (error.name === "ValidationError") {
          console.log("Validation error occurred:", error.message);
          // For validation errors, try to insert one by one to identify problematic records
          for (const outletDoc of validOutletsForDB) {
            try {
              const singleInsert = await OutletApproved.create(outletDoc);
              insertedOutlets.push(singleInsert);
            } catch (singleError) {
              console.error(
                `Failed to insert outlet ${outletDoc.outletCode}:`,
                singleError.message
              );
            }
          }
        } else {
          throw error;
        }
      }
    }

    // Transform data for response (keeping original format for compatibility)
    // Apply mobile number validation to transformed data as well
    const transformedData = validRows.map((row) => {
      const outletCode = row.outletCode || "TEMP";
      const outletUID = row.outletUID || outletCode;
      const rawMobile = row.Phone1;
      const cleanedMobile = rawMobile ? cleanPhoneNumber(rawMobile) : null;
      const validMobile =
        cleanedMobile && mobileRegex.test(cleanedMobile) ? cleanedMobile : "";
      return {
        outletCode: outletCode,
        outletUid: outletUID,
        outletName: row.Client_Name,
        ownerName: row.Client_Name,
        employeeCode: row.Label,
        beatCode: row.BeatId,
        stateCode: row.AddState,
        brandCode: "",
        mobile1: validMobile,
        mobile2: "",
        whatsappNumber: "",
        pin: "",
        preferredLanguage: "",
        teleCallDay: "",
        address1: row.FullAddress || "",
        address2: "",
        marketCenter: "",
        city: row.AddCity || "",
        aadharNumber: "",
        panNumber: "",
        gstin: "",
        location: "",
        gpsLocation: "",
        categoryOfOutlet: "RETAILER",
        existingRetailer: "FALSE",
        contactPerson: "",
        email: row.Email_Address || "",
        retailerClass: "A",
        enrolledStatus: "ENROLLED",
        shipToAddress: row.FullAddress || "",
        shipToPincode: "",
        outletSource: "SFA",
      };
    });

    res.status(200).json({
      error: false,
      message: `Outlets processed successfully. ${insertedOutlets.length} new outlets inserted (with combined duplicate phone data), ${outletUpdates.length} existing outlets updated with additional source data, ${skippedRows.length} outlets skipped.`,
      metadata: {
        totalFetched: outlets.length,
        totalProcessed: validRows.length,
        totalInserted: insertedOutlets.length,
        totalUpdated: outletUpdates.length,
        totalSkipped: skippedRows.length,
        validBeatIds: beatIds,
        validEmployeeIds: empIds,
      },
      data: {
        insertedOutlets: insertedOutlets.length,
        updatedOutlets: outletUpdates.length,
        transformedData: transformedData,
        skippedRows: skippedRows,
        originalData: outlets,
      },
    });
  } catch (error) {
    res.status(400);
    throw error;
  } finally {
    await releaseLock("syncOutletMaster");
    console.log("syncOutletMaster: Lock released, finished");
  }
});

// const deleteAllOutlets = asyncHandler(async (req, res) => {
//   console.log("Deleting all outlets...");

//   try {
//     // Delete all outlets from the database
//     const result = await OutletApproved.deleteMany({});

//     console.log(`Successfully deleted ${result.deletedCount} outlets`);

//     res.status(200).json({
//       error: false,
//       message: `Deleted ${result.deletedCount} outlets successfully.`,
//       deletedCount: result.deletedCount
//     });
//   } catch (error) {
//     console.error("Error deleting outlets:", error);
//     res.status(500).json({
//       error: true,
//       message: "Failed to delete outlets",
//       details: error.message
//     });
//   }
// });

module.exports = { fetchOutlet };
