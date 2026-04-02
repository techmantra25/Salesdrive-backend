const generateLoadSheetHTML = (loadSheet) => {
  // Validate input
  if (!loadSheet) {
    throw new Error("Load sheet data is required");
  }

  // Helper functions
  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const formatCurrency = (amount) => {
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
      }).format(amount || 0);
    } catch {
      return "₹0.00";
    }
  };

  // Generate product rows HTML
  const generateProductRows = (bills) => {
    if (!Array.isArray(bills)) return "";

    return bills
      .map((bill) => {
        if (!bill?.lineItems?.length) return "";

        return bill.lineItems
          .map(
            (item, index) => `
          <tr style="background-color: ${index % 2 === 0 ? "#f9f9f9" : "#fff"}">
            <td style="border: 1px solid #ddd; padding: 8px">${index + 1}</td>
            <td style="border: 1px solid #ddd; padding: 8px">${
              item?.product?.product_code || "N/A"
            }</td>
            <td style="border: 1px solid #ddd; padding: 8px">${
              item?.product?.sku_group__name || "N/A"
            }</td>
            <td style="border: 1px solid #ddd; padding: 8px">${
              item?.product?.size || "N/A"
            }</td>
            <td style="border: 1px solid #ddd; padding: 8px">${
              item?.uom || "N/A"
            }</td>
            <td style="border: 1px solid #ddd; padding: 8px">${
              item?.billQty || 0
            }</td>
            <td style="border: 1px solid #ddd; padding: 8px">${formatCurrency(
              item?.netAmt
            )}</td>
             <td style="border: 1px solid #ddd; padding: 8px; width: 20%"></td>
          </tr>
        `
          )
          .join("");
      })
      .join("");
  };

  // Generate bill detail HTML
  const generateBillDetail = (bills) => {
    if (!Array.isArray(bills) || bills.length === 0) return "";

    // Extract unique invoice numbers and order numbers
    const invoiceNumbers = [...new Set(bills.map((bill) => bill?.billNo))]
      .filter(Boolean)
      .join(", ");
    const orderNumbers = [...new Set(bills.map((bill) => bill?.orderNo))]
      .filter(Boolean)
      .join(", ");

    return `
    <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 16px">
      Invoice Details
    </h3>
    <div style="display: flex; margin-bottom: 5px">
      <div style="font-weight: bold; width: 140px; flex-shrink: 0">
        Invoice Number:
      </div>
      <div style="flex-grow: 1">
        ${invoiceNumbers || "N/A"}
      </div>
    </div>
  `;
  };

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Load Sheet - ${loadSheet.allocationNo || "N/A"}</title>
      </head>
      <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; font-size: 12px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">
          <h1 style="margin: 0; font-size: 24px;">LOAD SHEET</h1>
          <p style="margin: 5px 0;">Allocation No: ${
            loadSheet.allocationNo || "N/A"
          }</p>
          <p style="margin: 5px 0;">Date: ${formatDate(loadSheet.createdAt)}</p>
        </div>

        <!-- Info Tables -->
        <table style="width: 100%; margin-bottom: 20px;">
          <tr>
            <td style="width: 50%; padding-right: 10px;">
              <!-- Retailer Info -->
              <div style="border: 1px solid #ddd; padding: 10px; background: #f9f9f9;">
                <h3 style="margin: 0 0 10px; font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">
                  Retailer Information
                </h3>
                <table style="width: 100%;">
                  <tr>
                    <td style="font-weight: bold; width: 140px;">Outlet Name:</td>
                    <td>${loadSheet.retailerId?.outletName || "N/A"} (${
    loadSheet.retailerId?.outletCode || "N/A"
  })</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Owner:</td>
                    <td>${loadSheet.retailerId?.ownerName || "N/A"}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Address:</td>
                    <td>${loadSheet.retailerId?.address1 || ""}, ${
    loadSheet.retailerId?.city || ""
  }, ${loadSheet.retailerId?.pin || "N/A"}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Mobile:</td>
                    <td>${loadSheet.retailerId?.mobile1 || "N/A"}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Category:</td>
                    <td>${loadSheet.retailerId?.categoryOfOutlet || "N/A"}</td>
                  </tr>
                </table>
              </div>
            </td>
            <td style="width: 50%; padding-left: 10px;">
              <!-- Vehicle Info -->
              <div style="border: 1px solid #ddd; padding: 10px; background: #f9f9f9;">
                <h3 style="margin: 0 0 10px; font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">
                  Vehicle & Delivery Details
                </h3>
                <table style="width: 100%;">
                  <tr>
                    <td style="font-weight: bold; width: 140px;">Vehicle:</td>
                    <td>${loadSheet.vehicleId?.name || "N/A"} (${
    loadSheet.vehicleId?.vehicle_no || "N/A"
  })</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Vehicle Type:</td>
                    <td>${loadSheet.vehicleId?.type || "N/A"}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Capacity:</td>
                    <td>${loadSheet.vehicleId?.capacity || "N/A"} ${
    loadSheet.vehicleId?.capacity_unit || ""
  }</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Delivery Boy:</td>
                    <td>${loadSheet.deliveryBoyId?.name || "N/A"} (${
    loadSheet.deliveryBoyId?.deliveryBoyCode || "N/A"
  })</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Mobile:</td>
                    <td>${loadSheet.deliveryBoyId?.mobileNo || "N/A"}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold;">Beat:</td>
                    <td>${loadSheet.beatId?.name || "N/A"} (${
    loadSheet.beatId?.code || "N/A"
  })</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
        </table>

        ${generateBillDetail(loadSheet.billIds)}

        <!-- Products Table -->
        <h3 style="margin: 20px 0 10px; font-size: 16px;">Product Details</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10px;">
          <thead>
            <tr style="background: #f2f2f2;">
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">S.No</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Product Code</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Product Name</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Size</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">UOM</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Qty</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Net Amt</th>
              <th style="border: 1px solid #ddd; padding: 8px; text-align: left; width: 20%">Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${generateProductRows(loadSheet.billIds)}
          </tbody>
        </table>

        <!-- Signatures -->
        <div style="margin-top: 30px; display: flex; justify-content: space-between;">
          <div style="width: 200px; text-align: center;">
            <div style="border-top: 1px solid #333; margin-top: 50px; padding-top: 5px;">
              Delivery Boy Signature
            </div>
          </div>
          <div style="width: 200px; text-align: center;">
            <div style="border-top: 1px solid #333; margin-top: 50px; padding-top: 5px;">
              Retailer Signature
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  return html;
};

module.exports = generateLoadSheetHTML;
