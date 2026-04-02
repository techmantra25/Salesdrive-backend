const Price = require("../../../models/price.model");
const Region = require("../../../models/region.model");
const Distributor = require("../../../models/distributor.model");
const moment = require("moment-timezone");

const getBatchProductPricing = async (
  productIds,
  distributorId = null,
  regionId = null,
) => {
  try {
    const nowDateTime = moment().tz("Asia/Kolkata").toDate();

    // Step 1: Fetch all prices for all products in ONE query
    // IMPROVEMENT: Single query instead of N queries
    const priceList = await Price.find({
      productId: { $in: productIds },
      status: true,
    })
      .populate([
        {
          path: "createdBy",
          select: "",
        },
        {
          path: "distributorId",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "productId",
          select: "name product_code",
          populate: [
            {
              path: "cat_id",
              select: "",
            },
            {
              path: "collection_id",
              select: "",
            },
            {
              path: "brand",
              select: "",
            },
          ],
        },
      ])
      .sort({ _id: -1 })
      .lean(); // Use .lean() for better performance since we don't need mongoose documents

    // Step 2: Group prices by productId for easy lookup
    // IMPROVEMENT: O(1) lookup instead of filtering arrays repeatedly
    const pricesByProduct = {};
    productIds.forEach((id) => {
      pricesByProduct[id] = [];
    });

    priceList.forEach((price) => {
      const productId = price.productId._id.toString();
      if (pricesByProduct[productId]) {
        pricesByProduct[productId].push(price);
      }
    });

    // Step 3: Fetch distributor and region info if needed (only once, not per product)
    let distributor = null;
    let region = null;

    if (distributorId) {
      distributor = await Distributor.findOne({ _id: distributorId }).lean();

      if (!distributor) {
        // Return empty pricing for all products if distributor not found
        const result = {};
        productIds.forEach((id) => {
          result[id] = [];
        });
        return result;
      }

      // Use distributor's regionId if regionId not provided
      if (!regionId) {
        regionId = distributor.regionId.toString();
      }
    }

    if (regionId) {
      region = await Region.findOne({ _id: regionId }).lean();

      if (!region) {
        // Return empty pricing for all products if region not found
        const result = {};
        productIds.forEach((id) => {
          result[id] = [];
        });
        return result;
      }
    }

    // Step 4: Process pricing for each product (same logic as original API)
    const result = {};

    productIds.forEach((productId) => {
      const prices = pricesByProduct[productId] || [];

      // Helper function to check if price is valid based on effective date and expiry
      const isPriceValid = (price) => {
        const effectiveDate = moment(price?.effective_date)
          .tz("Asia/Kolkata")
          .startOf("day")
          .toDate();

        if (price?.expiresAt) {
          const expiresAt = moment(price?.expiresAt)
            .tz("Asia/Kolkata")
            .endOf("day")
            .toDate();

          return (
            moment(effectiveDate).isSameOrBefore(nowDateTime) &&
            moment(expiresAt).isSameOrAfter(nowDateTime)
          );
        } else {
          return moment(effectiveDate).isSameOrBefore(nowDateTime);
        }
      };

      // Case 1: No regionId and no distributorId - return national prices
      if (!regionId && !distributorId) {
        const filteredPrices = prices.filter(isPriceValid);
        result[productId] = filteredPrices;
        return;
      }

      // Case 2: regionId provided but no distributorId - return regional or national
      if (regionId && !distributorId) {
        const regionalPrices = prices.filter(
          (price) =>
            price?.price_type === "regional" &&
            price?.regionId?._id?.toString() === regionId &&
            isPriceValid(price),
        );

        const nationalPrices = prices.filter(
          (price) => price?.price_type === "national" && isPriceValid(price),
        );

        // Priority: regional > national
        result[productId] =
          regionalPrices.length > 0 ? regionalPrices : nationalPrices;
        return;
      }

      // Case 3: distributorId provided - return distributor > regional > national
      const distributorPrices = prices.filter(
        (price) =>
          price?.price_type === "distributor" &&
          price?.distributorId?._id?.toString() === distributorId?.toString() &&
          price?.regionId?._id?.toString() === regionId &&
          isPriceValid(price),
      );

      const regionalPrices = prices.filter(
        (price) =>
          price?.price_type === "regional" &&
          price?.regionId?._id?.toString() === regionId &&
          isPriceValid(price),
      );

      const nationalPrices = prices.filter(
        (price) => price?.price_type === "national" && isPriceValid(price),
      );

      // Priority: distributor > regional > national
      let finalPrices = distributorPrices;
      if (finalPrices.length === 0) {
        finalPrices = regionalPrices;
      }
      if (finalPrices.length === 0) {
        finalPrices = nationalPrices;
      }

      result[productId] = finalPrices;
    });

    return result;
  } catch (error) {
    console.error("Error in getBatchProductPricing:", error);
    throw error;
  }
};

module.exports = {
  getBatchProductPricing,
};
