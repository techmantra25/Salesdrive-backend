const asyncHandler = require("express-async-handler");
const RetailerOutletTransaction = require("../../models/retailerOutletTransaction.model");

const ObjectId = RetailerOutletTransaction.base.Types.ObjectId;

const editOutletTransaction = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { point, date, remark } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Id is required",
      });
    }

    const retailerTransaction = await RetailerOutletTransaction.findById(id);
    if (!retailerTransaction) {
      return res.status(400).json({
        success: false,
        message: "No Retailer Transaction found",
      });
    }

    const updateFields = {};

    if (point !== undefined) {
      if (typeof point !== "number" || point < 0) {
        return res.status(400).json({
          success: false,
          message: "Point must be a number greater than 0",
        });
      }
      updateFields.point = point;
    }

    if (date !== undefined) {
      const newDate = new Date(date);
      if (isNaN(newDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format",
        });
      }
      if (newDate > new Date()) {
        return res.status(400).json({
          success: false,
          message: "Date cannot be in the future",
        });
      }
      updateFields.createdAt = newDate;
    }

    if (remark !== undefined) {
      updateFields.remark = remark;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided to update",
      });
    }

    const updatedTransaction =
      await RetailerOutletTransaction.collection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateFields },
        { returnDocument: "after" },
      );

    return res.status(200).json({
      success: true,
      message: "Transaction updated successfully",
      data: updatedTransaction,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = { editOutletTransaction };