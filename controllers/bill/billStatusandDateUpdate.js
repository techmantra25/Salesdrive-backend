const asyncHandler = require("express-async-handler");
const Bill = require("../../models/bill.model");

// Statuses that support a date field
const STATUS_DATE_FIELD_MAP = {
  Delivered: "dates.deliveryDate",
  Cancelled: "dates.cancelledDate",
};

const billStatusAndDateUpdate = asyncHandler(async (req, res) => {
  try {
    const { billId, status, date } = req.body;

    console.log(`billId- ${billId}`)

    // ── Validate billId ──────────────────────────────────────────────────────
    if (!billId) {
      res.status(400);
      throw new Error("billId is required");
    }

    // ── At least one of status or date must be provided ──────────────────────
    if (!status && !date) {
      res.status(400);
      throw new Error("Provide at least a status or a date to update");
    }

    // ── Fetch the bill ───────────────────────────────────────────────────────
    const bill = await Bill.findById(billId);
    if (!bill) {
      res.status(404);
      throw new Error("Bill not found");
    }

    const currentStatus = bill.status;
    const updatePayload = {};

    // ── Only date provided (no status change) ────────────────────────────────
    if (!status && date) {
      if (!STATUS_DATE_FIELD_MAP[currentStatus]) {
        res.status(400);
        throw new Error(
          `Cannot set a date for bills with status "${currentStatus}". Date is only applicable for Delivered or Cancelled.`
        );
      }

      const dateField = STATUS_DATE_FIELD_MAP[currentStatus];
      updatePayload[dateField] = new Date(date);

      const updatedBill = await Bill.findByIdAndUpdate(
        billId,
        { $set: updatePayload },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        success: true,
        message: "Date updated successfully",
        data: updatedBill,
      });
    }

    // ── Status provided ──────────────────────────────────────────────────────
    const validStatuses = [
      "Pending",
      "Delivered",
      "Cancelled",
      "Vehicle Allocated",
      "Partially-Delivered",
    ];

    if (!validStatuses.includes(status)) {
      res.status(400);
      throw new Error(
        `Invalid status. Allowed values: ${validStatuses.join(", ")}`
      );
    }

    // No-op check
    if (status === currentStatus && !date) {
      res.status(400);
      throw new Error(`Bill is already in "${status}" status`);
    }

    updatePayload["status"] = status;

    // Use provided date or fallback to now
    const resolvedDate = date ? new Date(date) : new Date();

    // ── Date field logic based on new status ─────────────────────────────────
    if (status === "Delivered") {
      updatePayload["dates.deliveryDate"] = resolvedDate;
      updatePayload["dates.cancelledDate"] = null;
    } else if (status === "Cancelled") {
      updatePayload["dates.cancelledDate"] = resolvedDate;
      updatePayload["dates.deliveryDate"] = null;
    } else {
      // Pending / Vehicle Allocated / Partially-Delivered → clear both dates
      updatePayload["dates.deliveryDate"] = null;
      updatePayload["dates.cancelledDate"] = null;
    }

    const updatedBill = await Bill.findByIdAndUpdate(
      billId,
      { $set: updatePayload },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Bill updated successfully",
      data: updatedBill,
    });
  } catch (error) {
    res.status(500);
    throw error;
  }
});

module.exports = { billStatusAndDateUpdate };