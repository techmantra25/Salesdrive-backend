const asyncHandler = require("express-async-handler");
const OrderEntry = require("../../models/orderEntry.model");
const OutletApproved = require("../../models/outletApproved.model");
const Beat = require("../../models/beat.model");

// Get Order Entry Details by ID
const detailOrderEntry = asyncHandler(async (req, res) => {
try {
const orderEntry = await OrderEntry.findById(req.params.id).populate([
{
path: "distributorId",
select: "",
},
{
path: "salesmanName",
select: "",
},
{
path: "routeId",
select: "",
},
{
path: "retailerId",
select: "",
populate: [
{
path: "stateId",
select: "",
populate: {
path: "zoneId",
select: "",
},
},
{
path: "regionId",
select: "",
},
{
path: "beatId",
select: "",
},
],
},
{
path: "lineItems.product",
select: "",
},
{
path: "lineItems.price",
select: "",
},
{
path: "lineItems.inventoryId",
select: "",
},
{ path: "billIds", select: "" },
]);

if (!orderEntry) {
  res.status(404);
  throw new Error("Order Entry not found");
}

const orderData = orderEntry.toObject();


if (orderData.salesmanName?._id && orderData.retailerId?._id) {
  const salesmanId = orderData.salesmanName._id;
  const retailerId = orderData.retailerId._id;

  const outlet = await OutletApproved.findOne({
    _id: retailerId,
    employeeId: salesmanId,
    status: true,
  }).select("employeeId beatId");

  if (outlet?.beatId?.length) {
    const salesmanRoute = await Beat.findOne({
      _id: { $in: outlet.beatId },
      status: true,
    });

    if (salesmanRoute) {
      orderData.routeId = salesmanRoute;
    }
  }
}

if (orderData.manualOrderDate) {
  orderData.createdAt = orderData.manualOrderDate;
}

return res.status(200).json({
  status: 200,
  message: "Order Entry details retrieved successfully",
  data: orderData,
});


} catch (error) {
res.status(400);
throw new Error(error?.message || "Something went wrong");
}
}); // Get Order Entry Details by ID

module.exports = { detailOrderEntry }; 