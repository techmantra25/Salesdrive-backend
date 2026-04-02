const asyncHandler = require("express-async-handler");
const axios = require("axios");
const qs = require("qs");

const { RUPA_USERNAME, RUPA_PASSWORD } = require("../../config/server.config");

const OutletApproved = require("../../models/outletApproved.model");
const { acquireLock, releaseLock } = require("../../models/lock.model");

const mobileRegex = /^[6-9]\d{9}$/;

const cleanPhone = (phone) => {
  if (!phone) return "";
  return phone.toString().replace(/^\+91/, "").replace(/\D/g, "");
};

const syncOutletCodeUpdates = asyncHandler(async (req, res) => {
  if (!(await acquireLock("syncOutletCodeUpdateOnly"))) {
    res.status(400);
    throw new Error("Sync already running.");
  }

  try {
    // ================= DATE RANGE =================
    let EndDate = new Date().toLocaleDateString("en-US");

    let StartDate = new Date();
    StartDate.setDate(StartDate.getDate() - 90);
    StartDate = StartDate.toLocaleDateString("en-US");

    console.log(`started syncing outlets for ${StartDate} to ${EndDate}`);

    // ================= GET TOKEN =================
    const tokenRes = await axios.post(
      "https://api.massistcrm.com/token",
      qs.stringify({
        username: RUPA_USERNAME,
        password: RUPA_PASSWORD,
        grant_type: "password",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const token = tokenRes.data.access_token;

    // ================= FETCH DATA =================
    const outletRes = await axios({
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

    const outlets = outletRes?.data?.AllData || [];
    // const outlets = [ // sample response data
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
    //         "Client_Name": "MTS",
    //         "Phone1": "7436860572",
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
    // ];

    if (!outlets.length) {
      return res.status(200).json({
        error: false,
        message: "No outlets received.",
      });
    }

    let updatedCount = 0;
    let skipped = 0;

    for (const row of outlets) {
      const outletCode = row.Client_Id?.toString();
      const newName = row.Client_Name;
      const newMobile = cleanPhone(row.Phone1);
      const newGst = row.GSTNo || row.GST || "";
      const newPan = row.PANNo || row.PAN || "";
      const newAadhar = row.AadharNo || row.Aadhar || "";

      if (!outletCode || !newName || !mobileRegex.test(newMobile)) {
        skipped++;
        continue;
      }

      const existingOutlet = await OutletApproved.findOne({
        outletCode,
      });

      if (!existingOutlet) continue;

      const updateFields = {};

      if (existingOutlet.outletName !== newName) {
        updateFields.outletName = newName;
        updateFields.ownerName = newName;
      }

      if (existingOutlet.mobile1 !== newMobile) {
        updateFields.mobile1 = newMobile;
      }

      if (newGst && existingOutlet.gstin !== newGst) {
        updateFields.gstin = newGst;
      }

      if (newPan && existingOutlet.panNumber !== newPan) {
        updateFields.panNumber = newPan;
      }

      if (newAadhar && existingOutlet.aadharNumber !== newAadhar) {
        updateFields.aadharNumber = newAadhar;
      }

      if (Object.keys(updateFields).length > 0) {
        await OutletApproved.updateOne(
          { _id: existingOutlet._id },
          { $set: updateFields },
        );

        updatedCount++;
      }
    }

    res.status(200).json({
      error: false,
      message: "Outlet code update sync completed.",
      metadata: {
        totalFetched: outlets.length,
        updated: updatedCount,
        skipped,
      },
    });
  } catch (err) {
    res.status(400);
    throw err;
  } finally {
    await releaseLock("syncOutletCodeUpdateOnly");
  }
});

module.exports = { syncOutletCodeUpdates };
