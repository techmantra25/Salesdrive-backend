const formatCurrency = (amount = 0) =>
  Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1
  ).padStart(2, "0")}.${String(d.getFullYear()).slice(-2)}`;
};

// Groups line items by PRODUCT FAMILY so all SWR items sit together, all
// UPVC items sit together, etc. — instead of grouping by exact product
// code (which does nothing, since codes are always unique per line item).
// The family is taken from the first "-" segment of the description, e.g.
// "SWR-F-75MM-M/PLUS-..." -> "SWR", "UPVC-P-15MM-..." -> "UPVC".
// Groups keep the position of their FIRST occurrence in the original list,
// so the overall ordering still feels natural — it just clusters repeats
// of the same family instead of scattering them.
const getProductFamilyKey = (item) => {
  const description = item.description || "";
  const firstSegment = description.split("-")[0]?.trim();
  return firstSegment || item.code || "";
};

const groupItemsByProduct = (items) => {
  const groupOrder = [];
  const groups = new Map();

  items.forEach((item) => {
    const key = getProductFamilyKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(item);
  });

  return groupOrder.flatMap((key) => groups.get(key));
};

// Basic Rate = Basic Amt (grossAmt) divided by quantity. Uses delQty as the
// primary quantity; falls back to orderQty if delQty is 0/missing, so we
// never divide by zero.
const getBasicRate = (item) => {
  const qty = Number(item.delQty) || Number(item.orderQty) || 0;
  const amt = Number(item.grossAmt) || 0;
  return qty > 0 ? amt / qty : 0;
};

const generateOrderHTML = (data) => {
  const items = groupItemsByProduct(data?.items || []);

  const productRows = items
    .map(
      (item, index) => `
<tr>
  <td>${index + 1}</td>
  <td>${item.code || ""}</td>
  <td class="left">${item.description || ""}</td>





<td class="center">${item.delQty ?? 0}</td>
<td class="center">${item.orderQty ?? 0}</td>

<td class="center">${item.stdBox ?? 0}</td>
<td class="center">${item.stdPkt ?? 0}</td>

<td class="center">${item.stock ?? 0}</td>

<td class="right">₹ ${formatCurrency(item.mrp ?? 0)}</td>

<td class="right">${item.discount ?? 0}%</td>

<td class="right">₹ ${formatCurrency(getBasicRate(item))}</td>

<td class="right">₹ ${formatCurrency(item.grossAmt ?? 0)}</td>

<td class="center">${Number(item.boxQty ?? 0).toFixed(2)}</td>

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
  <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
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
.left {
  text-align: left;
}

.center {
  text-align: center;
}

.right {
  text-align: right;
}
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
    <td class="label">Outlet Code :</td>
    <td>${data.retailer?.outletCode || ""}</td>
    <td class="label">Driver Name &amp; Number :</td>
    <td>${data.driverName || ""}</td>
  </tr>

  <tr>
    <td class="label">Party Name :</td>
    <td>${data.retailer?.outletName || ""}</td>
   <td class="label">Total Boxes :</td>
<td>${Number(data.summary?.totalBoxes || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</td>
  </tr>

  <tr>
    <td class="label">Tally Billing Name :</td>
    <td>${data.tallyBillingName || ""}</td>
    <td class="label">Total Pipe Packets :</td>
    <td>${data.summary?.totalPipePackets || 0}</td>
  </tr>

  <tr>
    <td class="label">Sales Officer Name &amp; Number :</td>
    <td>${data.salesman?.name || ""}</td>
    <td class="label">Total Loose Pipes :</td>
    <td>${data.summary?.totalLoosePipes || 0}</td>
  </tr>

  <tr>
    <td class="label">Beat &amp; Route :</td>
    <td>${data.beatName || ""}</td>
    <td class="label">Material Sorted By :</td>
    <td>${data.materialSortedBy || ""}</td>
  </tr>

  <tr>
    <td class="label">Ph. Number :</td>
    <td>${data.retailer?.mobile1 || ""}</td>
    <td class="label">Verified :</td>
    <td>${data.verifiedBy || ""}</td>
  </tr>

  <tr>
    <td class="label">Handling &amp; Freight Charges :</td>
    <td>${data.freightCharge || ""}</td>
    <td></td>
    <td></td>
  </tr>

  <tr>
    <td class="label">Remarks :</td>
    <td colspan="3">${data.remarks || ""}</td>
  </tr>
</table>

<table class="product-table">
<tr class="total-row">
  <td colspan="11" style="text-align:right;">Total :</td>
  <td>₹ ${formatCurrency(data.summary?.netAmount)}</td>
  <td>${Number(data.summary?.totalBoxes || 0).toFixed(2)}</td>
</tr>
  <tr>
    <th width="4%">Sl No</th>
    <th width="9%">Code</th>
    <th width="33%">Product Description</th>
    <th width="5%">Del Qnty</th>
    <th width="5%">Order Qnty</th>
    <th width="5%">Std Box</th>
    <th width="5%">Std Pkt</th>
    <th width="5%">Avil Stock</th>
    <th width="6%">MRP</th>
    <th width="6%">Disc%</th>
    <th width="7%">Basic Rate</th>
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