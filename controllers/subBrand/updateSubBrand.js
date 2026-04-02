const asyncHandler = require("express-async-handler");
const SubBrand = require("../../models/subBrand.model");

const updateSubBrand = asyncHandler(async (req, res) => {
  try {
    // Check if the Brand ID is present in the Product model
    // const productWithBrand = await Product.findOne({
    //   subBrandId: req.params.subBrandId,
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
    let subBrandList = await SubBrand.findOneAndUpdate(
      { _id: req.params.subBrandId },
      req.body,
      { new: true }
    );

    if (subBrandList) {
      return res.status(201).json({
        status: 201,
        message: "Update Brand Successfully",
        data: subBrandList,
      });
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  updateSubBrand,
};
