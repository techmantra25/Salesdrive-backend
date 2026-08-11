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


const getProductFamilyKey = (item) => {
  const description = item.description || "";
  const segments = description.split("-");

  // Use the first 3 segments so "SWR-P" and "SWR-F" (pipe vs fitting)
  // are treated as DIFFERENT groups, not merged into one "SWR" bucket.
  // e.g. "SWR-P-110MM-M/PLUS-CR-TYP-A-10FT-SS-5413" -> "SWR-P-110MM"
  //      "COLUMN-P-32MM-10KG/CM2-V4-3M-W/S-4814"     -> "COLUMN-P-32MM"
  const familyKey = segments.slice(0, 3).join("-").trim();

  return familyKey || item.code || "";
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

  // Sort the GROUPS alphabetically (ascending) — this is what puts
  // "COLUMN-P-32MM" before "SWR-F-75MM" before "SWR-P-110MM" before
  // "UPVC-F-25MM" before "UPVC-P-25MM".
  const sortedGroupOrder = [...groupOrder].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );

  return sortedGroupOrder.flatMap((key) => groups.get(key));
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

  const totalBasicAmt = items.reduce(
    (sum, item) => sum + (Number(item.grossAmt) || 0),
    0
  );

  const productRows = items
    .map(
      (item, index) => `
<tr>
  <td class="right">${index + 1}</td>

  <td class="center">${item.code !== null &&
          item.code !== undefined &&
          item.code !== ""
          ? item.code
          : ""
        }</td>

  <td class="left">${item.description || ""}</td>

  <td class="right">${""}</td>


  <td class="right">${item.orderQty ?? 0}</td>

  <td class="right">${item.stdBox ?? 0}</td>

  <td class="right">${item.stock ?? 0}</td>

  <td class="right">₹ ${formatCurrency(item.mrp ?? 0)}</td>

  <td class="center">${formatCurrency(item.discount ?? 0)}%</td>

  <td class="right">₹ ${formatCurrency(getBasicRate(item))}</td>

  <td class="right">₹ ${formatCurrency(item.grossAmt ?? 0)}</td>
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
  <td>&nbsp;</td><td></td><td></td><td></td><td></td>
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
  margin: 8mm 8mm 14mm 8mm;

  /* Page number in the bottom-right corner of every printed page.
     Supported by print/PDF engines that implement CSS Paged Media
     (e.g. wkhtmltopdf, WeasyPrint, Prince, Firefox print preview).
     Chromium's own print pipeline does not render @page margin-box
     content, so if this is printed straight from Chrome the counter
     below will not show — the on-page footer fallback further down
     (".page-footer") is what covers that case instead. */
  @bottom-right {
    content: "Page - " counter(page);
    font-family: Arial, sans-serif;
    font-size: 10px;
  }
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

/* Repeat the table header (and the Total row that sits above it) on
   every printed page. This relies on the standard <thead> print
   behaviour, which is supported by every browser's print engine
   (Chrome, Firefox, Edge, Safari) as well as Puppeteer/wkhtmltopdf. */
.product-table thead {
  display: table-header-group;
}
.product-table tbody {
  display: table-row-group;
}

.empty-row td { height: 22px; }

/* Fallback / guaranteed page number footer for engines (like Chrome's
   print pipeline) that ignore @page margin boxes. This prints once at
   the very end of the content — for a true per-physical-page number in
   Chrome you'd need Puppeteer's page.pdf({ footerTemplate }) option,
   since Chrome does not expose page-break positions to plain CSS/HTML. */
.page-footer {
  margin-top: 6px;
  text-align: right;
  font-size: 10px;
}

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
<td></td>
  </tr>

  <tr>
    <td class="label">Tally Billing Name :</td>
    <td>${data.tallyBillingName || ""}</td>
   <td class="label">Total Pipe Packets :</td>
  <td></td>
  </tr>

  <tr>
    <td class="label">Sales Officer Name &amp; Number :</td>
    <td>${data.salesman?.name || ""}</td>
    <td class="label">Total Loose Pipes :</td>
    <td></td>
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
    <td class="label">Verified By :</td>
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
<thead>
  <tr class="total-row">
    <td colspan="10" style="text-align:right;">Total :</td>
    <td>₹ ${formatCurrency(totalBasicAmt)}</td>
  </tr>
  <tr>
    <th width="4%">Sl No</th>
    <th width="8%">Code</th>
    <th width="33%">Product Description</th>
    <th width="6%">Del Qnty</th>
    <th width="6%">Order Qnty</th>
    <th width="6%">Std Box</th>
    <th width="6%">Avil Stock</th>
    <th width="7%">MRP</th>
    <th width="6%">Disc%</th>
    <th width="8%">Basic Rate</th>
    <th width="10%">Basic Amt</th>
  </tr>
</thead>
<tbody>
  ${productRows}
  ${emptyRows}
</tbody>
</table>

</div>
</body>
</html>
`;
};

module.exports = generateOrderHTML;