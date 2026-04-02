const asyncHandler = require("express-async-handler");
const axios = require("axios");
const {
  RUPA_PASSWORD,
  RUPA_USERNAME,
  SERVER_URL,
} = require("../../config/server.config");
const qs = require("querystring");
// const OrderEntry = require("../../models/orderEntry.model");

const importSapSecondaryOrders = asyncHandler(async (req, res) => {
  try {
    console.log("Fetching SAP Secondary Order Entry Data...");
    // get current data (mm/dd/yyyy)
    let currentDate = new Date();
    currentDate = currentDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // previous date should be 7 days before current date
    let previousDate = new Date();
    previousDate.setDate(previousDate.getDate() - 7);
    previousDate = previousDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
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
    
        console.log('tokenResponse', tokenResponse);
        console.log("Token fetched successfully");
        const token = tokenResponse.data.access_token;
    
        console.log("calling the Order SKU Report API...", token);
    
        // Step 2: Call the Order SKU Report API
        const reportResponse = await axios({
          method: "post",
          url: "https://api.massistcrm.com/api/v2/Employee/GetAllOrderSKUData",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: {
            EmpList: "",
            ClientList: "",
            StartDate: previousDate,
            EndDate: currentDate,
            Category: "C1",
            DataFor: "OrderSKUDateWise",
            Division: "",
            DataState: "",
            filter: "order",
            DataZone: "South,North East,East,North,Center,West,Other",
            DataCity: "",
            ClientType: "",
            SubType: "",
            DataFilter: "",
            FromClientType: "",
            FromSubType: "",
            FromClientList: "",
            ClientTypeGroup: "",
            FromClientTypeGroup: "",
            ExcelName: "OrderSKUDateWise",
            ProductId: "",
            VarientId: "",
            Manufacturer: "__",
            ProductScheme: "",
            TotalOrderScheme: "",
            IsActive: "",
            IsDMS: "",
          },
        });
    
        console.log("Order SKU Report API called successfully");
    
        let data = reportResponse?.data?.AllData || [];
    
        if (!data || data.length === 0) {
          res.status(400);
          throw new Error("No data found for the given date range.");
        }


    res.status(200).json({
      status: 200,
      message: "Order SKU Report data fetched successfully",
      data: data,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { importSapSecondaryOrders };
