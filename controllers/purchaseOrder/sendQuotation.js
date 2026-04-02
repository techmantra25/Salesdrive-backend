const asyncHandler = require("express-async-handler");
const PurchaseOrderEntry = require("../../models/purchaseOrder.model");
const axios = require("axios");
const { NODE_ENV } = require("../../config/server.config");

// Helper function for date formatting
function getCurrentDateYYYYMMDD() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

const sendQuotation = asyncHandler(async (req, res) => {
  try {
    const { purchaseOrderId } = req.params;

    // Validate purchaseOrderId
    if (!purchaseOrderId) {
      return res.status(400).json({ message: "Purchase Order ID is required" });
    }

    const purchaseOrder = await PurchaseOrderEntry.findById(purchaseOrderId)
      .populate([
        { path: "distributorId", select: "" },
        { path: "supplierId", select: "" },
        {
          path: "lineItems.product",
          select: "",
          populate: [
            { path: "cat_id", select: "" },
            { path: "collection_id", select: "" },
            { path: "brand", select: "" },
          ],
        },
        { path: "lineItems.price", select: "" },
        { path: "lineItems.inventoryId", select: "" },
        { path: "approved_by", select: "" },
        { path: "updatedBy", select: "" },
        { path: "lineItems.plant", select: "" },
      ])
      .lean();

    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    if (purchaseOrder?.quotationSuccess) {
      return res.status(200).json({
        error: false,
        message: "Quotation already sent for this Purchase Order",
      });
    }

    if (NODE_ENV === "testing" || NODE_ENV === "development") {
      if (
        purchaseOrder &&
        purchaseOrder?.approvedStatus === "Approved" &&
        !purchaseOrder?.quotationSuccess
      ) {
        const order = await PurchaseOrderEntry.findByIdAndUpdate(
          purchaseOrder._id,
          {
            $set: {
              quotationResponse: {
                response: {
                  message: "Dummy response for testing",
                },
              },
              quotationSuccess: true,
            },
          }
        );

        return res.status(200).json({
          success: false,
          message: "Dummy success",
          data: order,
        });
      } else {
        return res.status(200).json({
          error: true,
          message: "Purchase Order is not approved or quotation already sent",
        });
      }
    }

    const trimRemark = (remark) => {
      if (!remark) return "";
      return remark.length > 100 ? remark.substring(0, 100) : remark;
    };

    // If approved, send to SAP
    if (
      purchaseOrder &&
      purchaseOrder?.approvedStatus === "Approved" &&
      !purchaseOrder?.quotationSuccess
    ) {
      const payload = {
        Bstnk: purchaseOrder.purchaseOrderNo,
        Auart: "ZQT",
        Vkorg: "1000",
        Vtweg: "10",
        Kunnr: purchaseOrder.distributorId?.dbCode,
        Aedat: getCurrentDateYYYYMMDD(),
        Remarks: trimRemark("DMS: " + purchaseOrder?.orderRemark),
        Info1: "",
        Info2: "",
        Info3: "",
        HeaderItem: purchaseOrder.lineItems.map((item) => {
          const UOMQty = item.boxOrderQty;
          let lineItemUOM = item.lineItemUOM;

          if (lineItemUOM === "pcs") {
            lineItemUOM = "PC";
          } else if (lineItemUOM === "box") {
            lineItemUOM = "BOX";
          } else if (lineItemUOM === "dz") {
            lineItemUOM = "DZ";
          }

          return {
            Bstnk: purchaseOrder.purchaseOrderNo,
            Matnr: item.product.product_code,
            Werks: item.plant.plantCode,
            Menge: String(UOMQty),
            Vstel: item.plant.plantCode,
            Zieme: lineItemUOM,
            Info1: "",
            Info2: "",
            Info3: "",
          };
        }),
        HeaderMessage: [
          {
            Bstnk: "",
            MessageQuo: "",
          },
        ],
      };

      // console.log(
      //   "Payload for SAP Quotation:",
      //   JSON.stringify(payload, null, 2)
      // );

      try {
        const response = await axios.post(
          "http://182.75.250.216:8000/sap/opu/odata/sap/ZRUPA_MASSIST_FINAL1_SRV/HeaderSet",
          payload,
          {
            headers: {
              "X-Requested-With": "X",
              "Content-Type": "application/json",
            },
          }
        );

        // Save quotation response in DB
        const order = await PurchaseOrderEntry.findByIdAndUpdate(
          purchaseOrder._id,
          {
            $set: {
              quotationResponse: response?.data || null,
              quotationSuccess: true,
            },
          }
        );

        return res.status(200).json({
          success: true,
          message:
            "Purchase Order updated successfully & Quotation created successfully",
          data: order,
          payload: payload,
        });
      } catch (sapError) {
        console.log(sapError);

        // Rollback approval status and save error response
        const order = await PurchaseOrderEntry.findByIdAndUpdate(
          purchaseOrder._id,
          {
            $set: {
              approvedStatus: "Not Approved",
              approved_by: null,
              approvedByType: null,
              quotationResponse: sapError?.response?.data || null,
              quotationSuccess: false,
            },
          }
        );

        return res.status(400).json({
          success: false,
          message: `Failed to update purchase order as create quotation in SAP failed ${
            sapError?.response?.data?.message || sapError.message
          }`,
          data: order,
          payload: payload,
        });
      }
    } else {
      return res.status(200).json({
        error: true,
        message: "Purchase Order is not approved or quotation already sent",
      });
    }
  } catch (error) {
    res.status(400);
    throw error;
  }
});

module.exports = { sendQuotation };
