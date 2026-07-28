const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");

// @desc    View remarks for an Order Enquiry
// @route   GET /api/order-enquiry/remarks-order-enquiry/:id
// @access  Private
const viewRemarksOrderEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const enquiry = await OrderEnquiry.findById(id).select(
    "enquiryNo remark additionalRemarks createdAt updatedAt",
  );

  if (!enquiry) {
    res.status(404);
    throw new Error("Order Enquiry not found");
  }

  res.status(200).json({
    success: true,
    message: "Remarks fetched successfully",
    data: {
      enquiryNo: enquiry.enquiryNo,
      remark: enquiry.remark,
      additionalRemarks: enquiry.additionalRemarks,
      updatedAt: enquiry.updatedAt,
    },
  });
});

module.exports = {
  viewRemarksOrderEnquiry,
};