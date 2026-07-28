const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");

const remarksOrderEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { additionalRemarks } = req.body;

  if (!additionalRemarks || !additionalRemarks.trim()) {
    res.status(400);
    throw new Error("Additional remarks are required");
  }

  const enquiry = await OrderEnquiry.findById(id);

  if (!enquiry) {
    res.status(404);
    throw new Error("Order Enquiry not found");
  }

  enquiry.additionalRemarks = additionalRemarks.trim();

  await enquiry.save();

  res.status(200).json({
    success: true,
    message: "Additional remarks updated successfully",
    data: enquiry,
  });
});

module.exports = {
  remarksOrderEnquiry,
};