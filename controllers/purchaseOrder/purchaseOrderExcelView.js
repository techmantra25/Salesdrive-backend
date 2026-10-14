const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../../models/purchaseOrder.model");
const Invoice = require("../../models/invoice.model");
const mongoose = require("mongoose");

// Paginated Purchase Order Entry Report with Filters
const purchaseOrderExcelView = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate,
      distributorId,
      godownId, // single godown filter
      godownIds, // comma-separated list of godown filters
      invoiceStatus, // "Pending" | "Partially-Invoiced" | "Complete-Invoiced" | "Cancelled"
      purchaseOrderId, // comma-separated list of PO ids
      purchaseOrderNo,
    } = req.query;

    let query = {};

    // Filter by status
    if (status) query.status = status;

    // Filter by invoice status (maps to the `invoicestatus` field on the document)
    if (invoiceStatus) {
      query.invoicestatus = invoiceStatus;
    }

    if (purchaseOrderNo) {
      query.purchaseOrderNo = purchaseOrderNo;
    }

    // Filter by distributor
    if (distributorId) query.distributorId = distributorId;

    // Filter by godown (single or multiple)
    if (godownId) {
      query.godownId = godownId;
    } else if (godownIds && godownIds !== "all") {
      const ids = [
        ...new Set(
          godownIds
            .split(",")
            .map((id) => id.trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id)),
        ),
      ];

      if (ids.length > 0) {
        query.godownId = { $in: ids };
      }
    }

    // Filter by date range (createdAt)
    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        const startOfDay = new Date(fromDate);
        startOfDay.setHours(0, 0, 0, 0);
        query.createdAt.$gte = startOfDay;
      }

      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endOfDay;
      }
    }

    // Filter by specific purchase order ids
    if (purchaseOrderId) {
      const ids = [
        ...new Set(
          purchaseOrderId
            .split(",")
            .map((id) => id.trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        ),
      ];

      if (ids.length > 0) {
        query._id = { $in: ids };
      } else {
        return res.status(400).json({
          status: 400,
          error: true,
          message: "No valid purchaseOrderId(s) provided.",
        });
      }
    }

    // Fetch data with pagination
    const purchaseOrders = await PurchaseOrder.find(query)
      .populate([
        {
          path: "distributorId",
          select: "name dbCode city stateId",
          populate: {
            path: "stateId",
            select: "name zoneId",
            populate: {
              path: "zoneId",
              select: "name",
            },
          },
        },
        {
          path: "godownId",
          select: "godownCode godownName godownType location isActive",
        },
        { path: "supplierId", select: "supplierName supplierCode" },
        {
          path: "lineItems.product",
          // "uom" is the product's own base UOM (e.g. "bndl"), separate
          // from lineItemUOM (the UOM the order qty was placed in, e.g. "box").
          select:
            "name cat_id collection_id brand subBrand product_code no_of_pieces_in_a_box uom",
          populate: [
            { path: "cat_id", select: "name" },
            { path: "collection_id", select: "name" },
            { path: "brand", select: "name" },
            { path: "subBrand", select: "name" },
          ],
        },
        { path: "lineItems.price", select: "dlp_price mrp_price" },
        { path: "lineItems.inventoryId", select: "availableQty intransitQty" },
        { path: "lineItems.plant", select: "" },
        {
          path: "updatedBy",
          select: "name empId dbCode desgId",
          strictPopulate: false,
        },
        {
          path: "approved_by",
          select: "name empId desgId",
          strictPopulate: false,
        },
      ])
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Optional: Manually populate desgId for Employee types
    const populatedOrders = await PurchaseOrder.populate(purchaseOrders, [
      {
        path: "updatedBy.desgId",
        select: "name code",
        strictPopulate: false,
      },
      {
        path: "approved_by.desgId",
        select: "name code",
        strictPopulate: false,
      },
    ]);

    // ---- Compute GRN qty / GRN L1 % / GRN status per line item ------------
    // NOTE: grnQty / grnBoxQty / grnL1 / grnStatus are NOT stored on the
    // PurchaseOrder document. They are derived from Invoice line items.
    //
    // Batch-fetch every invoice tied to any PO on this page in a single
    // query (instead of one query per PO/line item), then aggregate per
    // PO + product.
    const poIds = populatedOrders.map((po) => po._id);

    const invoices = poIds.length
      ? await Invoice.find({ purchaseOrderId: { $in: poIds } })
      : [];
    // If cancelled invoices must NOT count as received, use:
    // Invoice.find({ purchaseOrderId: { $in: poIds }, status: { $ne: "Cancelled" } })

    // All maps are keyed by "<purchaseOrderId>_<productId>"
    const receivedMap = {}; // total qty (PCS) received via invoices
    const grnGrossMap = {}; // total invoiced gross amount
    const grnMrpValueMap = {}; // total (qty * mrp), used to derive GRN L1 %

    for (const inv of invoices) {
      const poKey = String(inv.purchaseOrderId);
      for (const li of inv.lineItems || []) {
        const mapKey = `${poKey}_${String(li.product)}`;
        const qty = Number(li.qty || 0);

        receivedMap[mapKey] = (receivedMap[mapKey] || 0) + qty;
        grnGrossMap[mapKey] =
          (grnGrossMap[mapKey] || 0) + Number(li.grossAmount || 0);
        grnMrpValueMap[mapKey] =
          (grnMrpValueMap[mapKey] || 0) + qty * Number(li.mrp || 0);
      }
    }

    const ordersWithGrn = populatedOrders.map((po) => {
      const poObj = po.toObject ? po.toObject() : po;
      const poKey = String(poObj._id);

      const lineItems = (poObj.lineItems || []).map((item) => {
        const mapKey = `${poKey}_${String(item?.product?._id)}`;
        const alreadyReceived = receivedMap[mapKey] || 0;
        const piecesPerBox = Number(item?.product?.no_of_pieces_in_a_box || 1);
        const orderQty = Number(item?.orderQty || 0);

        // GRN L1 % = (1 - invoiced gross / (qty * MRP)) * 100
        // null when nothing has been invoiced for this line yet.
        const mrpValue = grnMrpValueMap[mapKey] || 0;
        const grnL1 =
          mrpValue > 0
            ? Number(
                ((1 - (grnGrossMap[mapKey] || 0) / mrpValue) * 100).toFixed(2),
              )
            : null;

        // Per-line GRN / invoice status
        //   Fully-Invoiced : received >= ordered
        //   Partial-GRN    : some received, but less than ordered
        //   Pending        : nothing received
        let grnStatus = "Pending";
        if (alreadyReceived > 0 && alreadyReceived >= orderQty) {
          grnStatus = "Fully-Invoiced";
        } else if (alreadyReceived > 0) {
          grnStatus = "Partial-GRN";
        }
 const isClosed =
          item?.foreclose === true || poObj?.status === "Cancelled";
        const poIntransitQty = isClosed
          ? 0
          : Math.max(orderQty - alreadyReceived, 0);
        return {
          ...item,
          grnQty: alreadyReceived,
          grnBoxQty: Math.floor(alreadyReceived / piecesPerBox),
          grnL1,
          grnStatus,
          poIntransitQty,
        };
      });

      return { ...poObj, lineItems };
    });
    // ------------------------------------------------------------------------

    const filteredCount = await PurchaseOrder.countDocuments(query);
    const totalCount = await PurchaseOrder.countDocuments({});

    res.status(200).json({
      status: 200,
      message: "Purchase orders list",
      data: ordersWithGrn,
      pagination: {
        currentPage: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(filteredCount / limit),
        filteredCount,
        totalCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = { purchaseOrderExcelView };