const asyncHandler = require("express-async-handler");
const Brand = require("../../models/brand.model");

const updateBrand = asyncHandler(async (req, res) => {
  try {
    // Check if the Brand ID is present in the Product model
    // const productWithBrand = await Product.findOne({
    //   brandId: req.params.brandId,
    // });

    // let message;

    // if (productWithBrand && req.body.hasOwnProperty("status")) {
    //   // If the Brand is present in the Product model, remove the status field from the update payload
    //   delete req.body.status;
    //   message = {
    //     error: false,
    //     statusUpdateError: true,
    //     message:
    //       "Brand is present in the Product model, status cannot be updated",
    //   };
    // }

    // Proceed with the brand update
    let brandList = await Brand.findOneAndUpdate(
      { _id: req.params.brandId },
      req.body,
      { new: true }
    );

    if (brandList) {
      return res.status(201).json({
        status: 201,
        message: "Update Brand Successfully",
        data: brandList,
      });
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  updateBrand,
};
