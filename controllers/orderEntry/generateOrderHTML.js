const formatCurrency = (amount = 0) =>
  Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const formatDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1
  ).padStart(2, "0")}.${String(d.getFullYear()).slice(-2)}`;
};

const generateOrderHTML = (data) => {
  const items = data?.items || [];

const productRows = items
  .map(
    (item, index) => `
<tr>
  <td>${index + 1}</td>
  <td>${item.code || ""}</td>
  <td class="left">${item.description || ""}</td>

  <td>${item.delQty ?? 0}</td>
  <td>${item.orderQty ?? 0}</td>

  <td>${item.stdBox ?? 0}</td>
  <td>${item.stdPkt ?? 0}</td>

  <td>${item.stock ?? 0}</td>

  <td>₹ ${formatCurrency(item.mrp ?? 0)}</td>

  <td>${item.discount ?? 0}%</td>

  <td>₹ ${formatCurrency(item.grossAmt ?? 0)}</td>

  <td>${item.boxQty ?? 0}</td>
</tr>
`
  )
  .join("");

  const emptyRows = Array.from({
    length: Math.max(0, 20 - items.length),
  })
    .map(
      () => `
<tr class="empty-row">
  <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td>
  <td></td><td></td><td></td><td></td><td></td><td></td>
</tr>
`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>

@page {
  size: A4 landscape;
  margin: 8mm;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #cfcfcf;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 20px;
  font-family: Arial, sans-serif;
  font-size: 11px;
}

.a4-page {
  background: #fff;
  width: 100%;          /* was: 297mm */
  min-height: 210mm;
  padding: 8mm;
  box-shadow: 0 2px 12px rgba(0,0,0,0.35);
  overflow: hidden;
}

@media print {
  body {
    background: none;
    padding: 0;
    display: block;
  }
  .a4-page {
    width: 100%;
    min-height: unset;
    padding: 0;          /* @page margin already handles spacing */
    box-shadow: none;
  }
}

table {
  width: 100%;
  border-collapse: collapse;
}

td, th {
  border: 1px solid #000;
  padding: 3px 4px;
}

.label {
  font-weight: bold;
  text-align: right;
  white-space: nowrap;
}

.left { text-align: left; }
.center { text-align: center; }

.dispatch-label {
  background: #fff200;
  font-weight: bold;
  text-align: right;
}

.total-row {
  font-weight: bold;
  font-size: 12px;
}

.product-table th {
  text-align: center;
  font-weight: bold;
}

.empty-row td { height: 22px; }

</style>
</head>

<body>
<div class="a4-page">

<table>
  <tr>
    <td class="dispatch-label" width="18%">Dispatch Advice :</td>
    <td width="50%">${data.distributor?.name || ""}</td>
    <td class="label" width="17%">Invoice Number :</td>
    <td width="15%">${data.invoiceNumber || ""}</td>
  </tr>
  <tr>
    <td class="label">Desp Adv No &amp; Date:</td>
    <td>${data.adviceNo || ""} Dt. ${formatDate(data.adviceDate)}</td>
    <td class="label">Lorry No :</td>
    <td>${data.lorryNo || ""}</td>
  </tr>
  <tr>
   <td class="label">Party Name &amp; Mob:</td>
<td>
  ${data.retailer?.outletName || ""}
  ${data.retailer?.mobile1 ? ` - ${data.retailer.mobile1}` : ""}
</td>
    <td class="label">Driver Name &amp; Number :</td>
    <td>${data.driverName || ""}</td>
  </tr>
  <tr>
    <td class="label">Tally Billing Name :</td>
    <td>${data.tallyBillingName || ""}</td>
    <td class="label">Total Boxes :</td>
    <td>${data.summary?.totalBoxes || 0}</td>
  </tr>
  <tr>
    <td class="label">Sales Officer Name &amp; Number :</td>
    <td>${data.salesman?.name || ""}</td>
    <td class="label">Total Pipe Packets :</td>
   <td>${data.summary?.totalPipePackets || 0}</td>
  </tr>
  <tr>
    <td class="label">Beat &amp; Route:</td>
    <td>${data.beatName || ""}</td>
    <td class="label">Total Loose Pipes :</td>
    <td>${data.summary?.totalLoosePipes || 0}</td> 
  </tr>
  <tr>
   <td class="label">Ph Number</td>
<td>${data.retailer?.mobile1 || ""}</td>
    <td class="label">Material Sorted By :</td>
    <td>${data.materialSortedBy || ""}</td>
  </tr>
  <tr>
    <td class="label">Handling &amp; Freight charges :</td>
    <td>${data.freightCharge || ""}</td>
    <td class="label">Verified :</td>
    <td>${data.verifiedBy || ""}</td>
  </tr>
  <tr>
    <td class="label">Remarks :</td>
    <td colspan="3">${data.remarks || ""}</td>
  </tr>
</table>

<table class="product-table">
  <tr class="total-row">
    <td colspan="10" style="text-align:right;">Total :</td>
    <td>₹ ${formatCurrency(data.summary?.grossAmount)}</td>
    <td>${data.summary?.totalBoxes || 0}</td>
  </tr>
  <tr>
    <th width="4%">Sl No</th>
    <th width="10%">Code</th>
    <th width="38%">Product Description</th>
    <th width="6%">Del Qnty</th>
    <th width="6%">Order Qnty</th>
    <th width="5%">Std Box</th>
    <th width="5%">Std Pkt</th>
    <th width="6%">Avil Stock</th>
    <th width="6%">MRP</th>
    <th width="6%">Disc%</th>
    <th width="8%">Basic Amt</th>
    <th width="6%">Total Box</th>
  </tr>
  ${productRows}
  ${emptyRows}
</table>

</div>
</body>
</html>
`;
};

module.exports = generateOrderHTML;