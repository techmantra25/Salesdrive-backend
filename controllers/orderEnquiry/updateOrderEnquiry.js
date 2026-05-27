const asyncHandler = require("express-async-handler");
const OrderEnquiry = require("../../models/orderEnquiry.model");

const updateOrderEnquiry = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const orderEnquiry = await OrderEnquiry.findById(id);
    if (!orderEnquiry) {
      return res.status(404).json({
        status: 404,
        message: "Order Enquiry not found",
      });
    }

    if (orderEnquiry.status === "Converted") {
      return res.status(400).json({
        status: 400,
        message: "Converted Order Enquiry cannot be updated",
      });
    }

    const updatedOrderEnquiry = await OrderEnquiry.findOneAndUpdate(
      { _id: id },
      req.body,
      { new: true },
    );

    res.status(200).json({
      status: 200,
      message: "Order Enquiry updated successfully",
      data: updatedOrderEnquiry,
    });
  } catch (error) {
    res.status(400).json({
      status: 400,
      message: error?.message || "Something went wrong",
    });
  }
});

module.exports = { updateOrderEnquiry };
