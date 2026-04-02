const asyncHandler = require("express-async-handler");
const Product = require("../../models/product.model");
const Category = require("../../models/category.model");
const Collection = require("../../models/collection.model");
const Price = require("../../models/price.model");
const User = require("../../models/user.model");
const State = require("../../models/state.model");
const Zone = require("../../models/zone.model");
const Region = require("../../models/region.model");
const Brand = require("../../models/brand.model");
const Designation = require("../../models/designation.model");
const Employee = require("../../models/employee.model");
const Beat = require("../../models/beat.model");
const Outlet = require("../../models/outlet.model");
const Distributor = require("../../models/distributor.model");
const OutletApproved = require("../../models/outletApproved.model");

const StatisticsCount = asyncHandler(async (req, res) => {
  try {
    let ProductCount = await Product.countDocuments({ status: true });
    let CategoryCount = await Category.countDocuments({ status: true });
    let CollectionCount = await Collection.countDocuments({ status: true });
    let PriceCount = await Price.countDocuments({ status: true });
    let UserCount = await User.countDocuments({ role: "user" });
    let StateCount = await State.countDocuments({ status: true });
    let ZoneCount = await Zone.countDocuments({ status: true });
    let RegionCount = await Region.countDocuments({ status: true });
    let BrandCount = await Brand.countDocuments({ status: true });
    let DesignationCount = await Designation.countDocuments({ status: true });
    let EmployeeCount = await Employee.countDocuments({ status: true });
    let BeatCount = await Beat.countDocuments({ status: true });
    //let OutletCount = await Outlet.countDocuments({ outletStatus: "Approved" });
    let OutletCount = await OutletApproved.countDocuments();
    let distributorCount = await Distributor.countDocuments({ status: true });

    return res.status(201).json({
      status: 201,
      message: "All data count",
      data: {
        ProductCount,
        CategoryCount,
        CollectionCount,
        PriceCount,
        UserCount,
        StateCount,
        ZoneCount,
        RegionCount,
        BrandCount,
        DesignationCount,
        EmployeeCount,
        BeatCount,
        OutletCount,
        distributorCount,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  StatisticsCount,
};
