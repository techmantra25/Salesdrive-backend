const asyncHandler = require("express-async-handler");

const OrderEntry = require("../../models/orderEntry.model");
const DbBank = require("../../models/dbBank.model");
const DBRule = require("../../models/dbRule.model");
const DBUpi = require("../../models/dbUpi.model");

const generateOrderHTML = require("./generateOrderHTML");

const advicePrint = asyncHandler(async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderEntry.findById(orderId)
      .populate("distributorId")
      .populate("retailerId")
      .populate("salesmanName")
      .populate("routeId")
      .populate({
        path: "lineItems.product",
      })
      .populate({
        path: "lineItems.price",
      })
      .populate({
        path: "lineItems.inventoryId",
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const [bankDetails, rules, upiDetails] = await Promise.all([
      DbBank.findOne({
        distributorId: order.distributorId?._id,
      }),
      DBRule.findOne({
        dbId: order.distributorId?._id,
        module: "Invoice T&C",
      }),
      DBUpi.findOne({
        distributorId: order.distributorId?._id,
        isActive: true,
      }),
    ]);

    const totalBoxes = order.lineItems.reduce(
      (sum, item) => sum + Number(item.boxOrderQty || 0),
      0
    );

    const dispatchAdviceData = {
      adviceNo: `DA-${order.orderNo}`,
      adviceDate: new Date(),
      orderDate: order.createdAt,

      distributor: order.distributorId,
      retailer: order.retailerId,
      salesman: order.salesmanName,
      route: order.routeId,

      bankDetails,
      upiDetails,

      termsAndConditions: rules?.rules || [],

      summary: {
        totalLines: order.totalLines,
        grossAmount: order.grossAmount,
        taxableAmount: order.taxableAmount,
        invoiceAmount: order.invoiceAmount,
        netAmount: order.netAmount,
        cgst: order.cgst,
        sgst: order.sgst,
        igst: order.igst,
        schemeDiscount: order.schemeDiscount,
        distributorDiscount: order.distributorDiscount,
        totalBoxes,
      },

      remarks: order.remark || "",

      items: order.lineItems.map((item, index) => ({
        slNo: index + 1,
        ...item.toObject(),
      })),
    };

    let htmlContent = generateOrderHTML(dispatchAdviceData);

    const autoPrintScript = `
      <style>
        @media print {
          .print-btn, .close-btn {
            display:none;
          }
        }

        .print-btn,
        .close-btn{
          position:fixed;
          top:20px;
          z-index:9999;
          border:none;
          color:#fff;
          cursor:pointer;
          padding:8px 14px;
          border-radius:4px;
          font-size:14px;
        }

        .print-btn{
          right:100px;
          background:#1976d2;
        }

        .close-btn{
          right:20px;
          background:#d32f2f;
        }
      </style>

      <button id="printBtn" class="print-btn">
        🖨️ Print
      </button>

      <button id="closeBtn" class="close-btn">
        ✖ Close
      </button>

      <script>
        window.onload = function() {

          document
            .getElementById("printBtn")
            .addEventListener("click", () => {
              window.print();
            });

          document
            .getElementById("closeBtn")
            .addEventListener("click", () => {
              window.close();
            });

          window.print();
        };

        document.addEventListener("contextmenu", function(e){
          e.preventDefault();
        });
      </script>
    `;

    if (htmlContent.includes("</body>")) {
      htmlContent = htmlContent.replace(
        "</body>",
        `${autoPrintScript}</body>`
      );
    } else {
      htmlContent += autoPrintScript;
    }

    res.setHeader("Content-Type", "text/html");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;"
    );

    res.send(htmlContent);

  } catch (error) {
    console.error(error);

    res.status(500).send(`
      <h2>Dispatch Advice Print Failed</h2>
      <p>${error.message}</p>
    `);
  }
});

module.exports = {
  advicePrint,
};