const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");

const closeOrderEnquiry = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const enquiry = await OrderEnquiry.findById(id);

  if (!enquiry) {
    res.status(404);
    throw new Error("Order Enquiry not found");
  }

  if (enquiry.status === "Converted") {
    res.status(400);
    throw new Error("Converted enquiry cannot be closed");
  }

  if (enquiry.status === "Closed") {
    res.status(400);
    throw new Error("Enquiry is already closed");
  }

  enquiry.status = "Closed";
  await enquiry.save();

  res.status(200).json({
    success: true,
    message: "Order enquiry closed successfully",
    data: enquiry,
  });
});

module.exports = {
  closeOrderEnquiry,
};