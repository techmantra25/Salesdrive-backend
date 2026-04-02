const asyncHandler = require("express-async-handler");
const Price = require("../models/price.model");
const { generateCode } = require("../utils/codeGenerator");
const moment = require("moment-timezone");
const Region = require("../models/region.model");
const Distributor = require("../models/distributor.model");
const Product = require("../models/product.model");

const addPrice = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const PriceCode = await generateCode("PR");
    let {
      productId,
      price_type,
      regionId,
      mrp_price,
      dlp_price,
      rlp_price,
      effective_date,
      distributorId,
    } = req.body;

    // Build query based on price type
    let queryFilter = {
      productId,
      status: true,
    };

    if (price_type === "national") {
      // For national pricing, regionId and distributorId should be null
      queryFilter.regionId = null;
      queryFilter.distributorId = null;
    } else if (price_type === "distributor") {
      // For distributor pricing, both regionId and distributorId are required
      queryFilter.regionId = regionId;
      queryFilter.distributorId = distributorId;
    } else {
      // For regional pricing, regionId is required, distributorId should be null
      queryFilter.regionId = regionId;
      queryFilter.distributorId = null;
    }

    const existingPrices = await Price.find(queryFilter).sort({
      effective_date: -1,
    });

    const effectiveDate = moment
      .tz(effective_date, "YYYY-MM-DD", "Asia/Kolkata")
      .startOf("day")
      .toDate();

    if (existingPrices.length > 0) {
      const latestPrice = existingPrices[0];
      const dateToday = new Date();

      //  if the effective date is today or before, return error
      if (effectiveDate <= dateToday) {
        res.status(400);
        throw new Error(
          "Price effective date should be greater than the today date"
        );
      }

      // id the latest price effective date is greater than or equal to the new price effective date return error
      if (
        moment(latestPrice.effective_date)
          .tz("Asia/Kolkata")
          .isSameOrAfter(effectiveDate)
      ) {
        res.status(400);
        throw new Error(
          "Price effective date should be less than the latest price effective date"
        );
      }

      const expiresAt = moment(effectiveDate)
        .tz("Asia/Kolkata")
        .subtract(1, "day")
        .endOf("day")
        .toDate();

      for (const price of existingPrices) {
        price.expiresAt = price.expiresAt ?? expiresAt;
        await price.save();
      }
    }

    // Create a new price entry
    const price = new Price({
      code: PriceCode,
      productId,
      price_type,
      regionId: price_type === "national" ? null : regionId,
      mrp_price,
      dlp_price,
      rlp_price,
      distributorId: price_type === "distributor" ? distributorId : null,
      effective_date,
      createdBy: userId,
    });

    // Save the price entry to the database
    const savedPrice = await price.save();

    return res.status(201).json({
      status: 201,
      message: "Price added successfully",
      data: savedPrice,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const addDBPriceByDB = asyncHandler(async (req, res) => {
  try {
    const PriceCode = await generateCode("PR");
    let {
      productId,
      price_type,
      regionId,
      mrp_price,
      dlp_price,
      rlp_price,
      effective_date,
      distributorId,
    } = req.body;

    // Build query based on price type
    let queryFilter = {
      productId,
      status: true,
    };

    if (price_type === "national") {
      // For national pricing, regionId and distributorId should be null
      queryFilter.regionId = null;
      queryFilter.distributorId = null;
    } else if (price_type === "distributor") {
      // For distributor pricing, both regionId and distributorId are required
      queryFilter.regionId = regionId;
      queryFilter.distributorId = distributorId;
    } else {
      // For regional pricing, regionId is required, distributorId should be null
      queryFilter.regionId = regionId;
      queryFilter.distributorId = null;
    }

    const existingPrices = await Price.find(queryFilter).sort({
      effective_date: -1,
    });

    const effectiveDate = moment
      .tz(effective_date, "YYYY-MM-DD", "Asia/Kolkata")
      .startOf("day")
      .toDate();

    if (existingPrices.length > 0) {
      const latestPrice = existingPrices[0];

      // Check if the latest price effective date is greater than or equal to the new price effective date
      if (
        moment(latestPrice.effective_date)
          .tz("Asia/Kolkata")
          .isSameOrAfter(effectiveDate)
      ) {
        res.status(400);
        throw new Error(
          "Price effective date should be greater than the latest price effective date"
        );
      }

      const expiresAt = moment(effectiveDate)
        .tz("Asia/Kolkata")
        .subtract(1, "day")
        .endOf("day")
        .toDate();

      for (const price of existingPrices) {
        price.expiresAt = price.expiresAt ?? expiresAt;
        await price.save();
      }
    }

    // Create a new price entry
    const price = new Price({
      code: PriceCode,
      productId,
      price_type,
      regionId: price_type === "national" ? null : regionId,
      mrp_price,
      dlp_price,
      rlp_price,
      distributorId: price_type === "distributor" ? distributorId : null,
      effective_date,
    });

    // Save the price entry to the database
    const savedPrice = await price.save();

    return res.status(201).json({
      status: 201,
      message: "Price added successfully",
      data: savedPrice,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const priceDetail = asyncHandler(async (req, res) => {
  try {
    let priceData = await Price.findOne({
      _id: req.params.priceId,
    }).populate([
      {
        path: "createdBy",
        select: "name role",
      },
      {
        path: "distributorId",
        select: "name role dbCode",
      },
      {
        path: "regionId",
        select: "",
      },
    ]);
    return res.status(201).json({
      status: 201,
      message: "Price Data",
      data: priceData,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const updatePrice = asyncHandler(async (req, res) => {
  try {
    let priceData = await Price.findOne({ _id: req.params.priceId }).populate([
      {
        path: "productId",
        select: "",
      },
      {
        path: "regionId",
        select: "",
      },
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "createdBy",
        select: "",
      },
    ]);

    if (priceData.expiresAt) {
      if (priceData.expiresAt <= new Date()) {
        res.status(400);
        throw new Error("Price expired can not be updated");
      }
    }

    // Determine regionId and distributorId based on price_type
    const priceType = req.body.price_type ?? priceData.price_type;
    let regionId, distributorId;

    if (priceType === "national") {
      regionId = null;
      distributorId = null;
    } else if (priceType === "distributor") {
      regionId = req.body.regionId ?? priceData.regionId;
      distributorId = req.body.distributorId ?? priceData.distributorId;
    } else {
      // regional
      regionId = req.body.regionId ?? priceData.regionId;
      distributorId = null;
    }

    let priceList = await Price.findOneAndUpdate(
      { _id: req.params.priceId },
      {
        productId: req.body.productId ?? priceData.productId,
        price_type: priceType,
        regionId: regionId,
        mrp_price: req.body.mrp_price ?? priceData.mrp_price,
        dlp_price: req.body.dlp_price ?? priceData.dlp_price,
        rlp_price: req.body.rlp_price ?? priceData.rlp_price,
        distributorId: distributorId,
        effective_date: req.body.effective_date ?? priceData.effective_date,
        status: req.body.status ?? priceData.status,
      },
      { new: true }
    ).populate([
      {
        path: "productId",
        select: "",
      },
      {
        path: "regionId",
        select: "",
      },
      {
        path: "distributorId",
        select: "",
      },
      {
        path: "createdBy",
        select: "",
      },
    ]);
    if (priceList) {
      message = {
        error: false,
        message: "Price updated successfully",
        data: priceList,
      };
      return res.status(200).send(message);
    } else {
      message = {
        error: true,
        message: "Price not upadated",
      };
      return res.status(500).send(message);
    }
  } catch (error) {
    console.error(error);
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const pricingStatusBulkUpdate = asyncHandler(async (req, res) => {
  try {
    const now = new Date();

    // Step 1: Update expired prices
    const expiredResult = await Price.updateMany(
      { expiresAt: { $lte: now }, status: true },
      { $set: { status: false } }
    );

    // Step 2: Handle duplicate regional prices
    const duplicateRegionalPrices = await Price.aggregate([
      {
        $match: {
          status: true,
          price_type: "regional",
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $lte: new Date() } },
          ],
        },
      },
      {
        $group: {
          _id: {
            productId: "$productId",
            regionId: "$regionId",
          },
          prices: {
            $push: {
              _id: "$_id",
              createdAt: "$createdAt",
              effective_date: "$effective_date",
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);

    let deactivatedRegionalCount = 0;
    for (const duplicateGroup of duplicateRegionalPrices) {
      // Sort by effective_date descending, then by createdAt descending (keep the latest)
      const sortedPrices = duplicateGroup.prices.sort((a, b) => {
        // First sort by effective_date
        if (a.effective_date && b.effective_date) {
          const dateCompare =
            new Date(b.effective_date) - new Date(a.effective_date);
          if (dateCompare !== 0) return dateCompare;
        }
        // If effective_dates are same or null, sort by createdAt
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      // Keep the first (latest) price, deactivate the rest
      const pricesToDeactivate = sortedPrices.slice(1).map((p) => p._id);

      if (pricesToDeactivate.length > 0) {
        const regionalResult = await Price.updateMany(
          { _id: { $in: pricesToDeactivate } },
          { $set: { status: false } }
        );
        deactivatedRegionalCount += regionalResult.modifiedCount;
      }
    }

    // Step 3: Handle duplicate distributor prices
    const duplicateDistributorPrices = await Price.aggregate([
      {
        $match: {
          status: true,
          price_type: "distributor",
          distributorId: { $ne: null },
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $lte: new Date() } },
          ],
        },
      },
      {
        $group: {
          _id: {
            productId: "$productId",
            regionId: "$regionId",
            distributorId: "$distributorId",
          },
          prices: {
            $push: {
              _id: "$_id",
              createdAt: "$createdAt",
              effective_date: "$effective_date",
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);

    let deactivatedDistributorCount = 0;
    for (const duplicateGroup of duplicateDistributorPrices) {
      // Sort by effective_date descending, then by createdAt descending (keep the latest)
      const sortedPrices = duplicateGroup.prices.sort((a, b) => {
        // First sort by effective_date
        if (a.effective_date && b.effective_date) {
          const dateCompare =
            new Date(b.effective_date) - new Date(a.effective_date);
          if (dateCompare !== 0) return dateCompare;
        }
        // If effective_dates are same or null, sort by createdAt
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      // Keep the first (latest) price, deactivate the rest
      const pricesToDeactivate = sortedPrices.slice(1).map((p) => p._id);

      if (pricesToDeactivate.length > 0) {
        const distributorResult = await Price.updateMany(
          { _id: { $in: pricesToDeactivate } },
          { $set: { status: false } }
        );
        deactivatedDistributorCount += distributorResult.modifiedCount;
      }
    }

    return res.status(200).json({
      status: 200,
      message: "Price status updated successfully",
      data: {
        expiredPricesDeactivated: expiredResult.modifiedCount,
        duplicateRegionalPricesDeactivated: deactivatedRegionalCount,
        duplicateDistributorPricesDeactivated: deactivatedDistributorCount,
        totalDuplicateGroupsFound: {
          regional: duplicateRegionalPrices.length,
          distributor: duplicateDistributorPrices.length,
        },
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const PriceALList = asyncHandler(async (req, res) => {
  try {
    let priceList = await Price.find({})
      .populate([
        {
          path: "createdBy",
          select: "name role",
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
          select: "",
          populate: [
            {
              path: "cat_id",
              select: " ",
            },
            {
              path: "collection_id",
              select: " ",
            },
            {
              path: "brand",
              select: " ",
            },
          ],
        },
      ])
      .sort({ _id: -1 });
    return res.status(201).json({
      status: 201,
      message: "Price list",
      data: priceList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const PriceALListPaginated = asyncHandler(async (req, res) => {
  try {
    const {
      selectedCategory,
      selectedBrand,
      selectedCollection,
      selectedRegion,
      selectDistributor,
      selectedPriceType,
      selectedStatus,
      selectedProduct,
      dateRange,
      createdAtRange,
      expiresAtRange,
      productCode,
      priceCode,
    } = req.query;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = {};

    // --- Product-related filters ---
    const productQuery = {};

    if (selectedCategory && selectedCategory !== "default") {
      productQuery.cat_id = selectedCategory;
    }
    if (selectedBrand && selectedBrand !== "default") {
      productQuery.brand = selectedBrand;
    }
    if (selectedCollection && selectedCollection !== "default") {
      productQuery.collection_id = selectedCollection;
    }
    if (selectedProduct && selectedProduct !== "default") {
      productQuery._id = selectedProduct;
    }
    if (productCode && productCode !== "default") {
      const searchRegex = new RegExp(productCode, "i");
      productQuery.$or = [
        { product_code: searchRegex },
        { name: searchRegex },
        { sku_group_id: searchRegex },
        { sku_group__name: searchRegex },
        { product_hsn_code: searchRegex },
      ];
    }

    let productIds = null;
    if (Object.keys(productQuery).length > 0) {
      const products = await Product.find(productQuery).select("_id");
      if (!products.length) {
        return res.status(200).json({
          status: 200,
          message: "No products found for the given filters",
          data: [],
          pagination: {
            currentPage: page,
            totalPages: 0,
            totalItems: 0,
            filteredCount: 0,
            totalActivePrices: 0,
          },
        });
      }
      productIds = products.map((p) => p._id);
      query.productId = { $in: productIds };
    }

    // --- Other filters ---
    if (selectedRegion && selectedRegion !== "default") {
      query.regionId = selectedRegion;
    }
    if (selectDistributor && selectDistributor !== "default") {
      query.distributorId = selectDistributor;
    }
    if (selectedPriceType && selectedPriceType !== "default") {
      query.price_type = selectedPriceType;
    }
    if (selectedStatus && selectedStatus !== "default") {
      query.status = selectedStatus;
    }
    if (priceCode && priceCode !== "default") {
      query.code = priceCode;
    }

    const TIMEZONE = "Asia/Kolkata";

    // --- Date filters ---
    if (dateRange) {
      const { startDate, endDate } = dateRange;
      if (startDate && endDate) {
        query.effective_date = {
          $gte: moment.tz(startDate, TIMEZONE).startOf("day").toDate(),
          $lte: moment.tz(endDate, TIMEZONE).endOf("day").toDate(),
        };
      }
    }
    if (createdAtRange) {
      const { startDate, endDate } = createdAtRange;
      if (startDate && endDate) {
        query.createdAt = {
          $gte: moment.tz(startDate, TIMEZONE).startOf("day").toDate(),
          $lte: moment.tz(endDate, TIMEZONE).endOf("day").toDate(),
        };
      }
    }
    if (expiresAtRange) {
      const { startDate, endDate } = expiresAtRange;
      if (startDate && endDate) {
        query.expiresAt = {
          $gte: moment.tz(startDate, TIMEZONE).startOf("day").toDate(),
          $lte: moment.tz(endDate, TIMEZONE).endOf("day").toDate(),
        };
      }
    }

    // --- Fetch prices with pagination ---
    const priceList = await Price.find(query)
      .populate([
        { path: "createdBy", select: "" },
        { path: "distributorId", select: "" },
        { path: "regionId", select: "" },
        {
          path: "productId",
          select: "",
          populate: [
            { path: "cat_id", select: "" },
            { path: "collection_id", select: "" },
            { path: "brand", select: "" },
          ],
        },
      ])
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const filteredCount = await Price.countDocuments(query);
    const totalItems = await Price.countDocuments();
    const totalActivePrices = await Price.countDocuments({ status: true });

    return res.status(200).json({
      status: 200,
      message: "Price list",
      data: priceList,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(filteredCount / limit),
        totalItems,
        filteredCount,
        totalActivePrices,
      },
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const PricingAllListReport = asyncHandler(async (req, res) => {
  try {
    const {
      selectedCategory,
      selectedBrand,
      selectedCollection,
      selectedRegion,
      selectDistributor,
      selectedPriceType,
      selectedStatus,
      selectedProduct,
      dateRange,
      createdAtRange,
      expiresAtRange,
    } = req.query;

    const query = {};

    // Region filter
    if (selectedRegion && selectedRegion !== "default") {
      query.regionId = selectedRegion;
    }

    // Distributor filter
    if (selectDistributor && selectDistributor !== "default") {
      query.distributorId = selectDistributor;
    }

    // Price Type filter
    if (selectedPriceType && selectedPriceType !== "default") {
      query.price_type = selectedPriceType;
    }

    // Status filter
    if (selectedStatus && selectedStatus !== "default") {
      query.status = selectedStatus;
    }

    // Product filter
    if (selectedProduct && selectedProduct !== "default") {
      query.productId = selectedProduct;
    }

    // Date Range filter
    if (dateRange) {
      const { startDate, endDate } = dateRange;
      const start = moment(startDate).startOf("day").toDate();
      const end = moment(endDate).endOf("day").toDate();
      if (startDate && endDate) {
        query.effective_date = {
          $gte: start,
          $lte: end,
        };
      }
    }

    // Created At Range filter
    if (createdAtRange) {
      const { startDate, endDate } = createdAtRange;
      const start = moment(startDate).startOf("day").toDate();
      const end = moment(endDate).endOf("day").toDate();
      if (startDate && endDate) {
        query.createdAt = {
          $gte: start,
          $lte: end,
        };
      }
    }

    // Expires At Range filter
    if (expiresAtRange) {
      const { startDate, endDate } = expiresAtRange;
      const start = moment(startDate).startOf("day").toDate();
      const end = moment(endDate).endOf("day").toDate();
      if (startDate && endDate) {
        query.expiresAt = {
          $gte: start,
          $lte: end,
        };
      }
    }

    // Fetching the price list with the query and pagination
    let priceList = await Price.find(query)
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
      .sort({ _id: -1 });

    let filteredPrices = [...priceList];

    if (selectedCategory && selectedCategory !== "default") {
      filteredPrices = filteredPrices.filter((price) => {
        return price?.productId?.cat_id?._id?.toString() === selectedCategory;
      });
    }

    if (selectedBrand && selectedBrand !== "default") {
      filteredPrices = filteredPrices.filter((price) => {
        return price?.productId?.brand?._id?.toString() === selectedBrand;
      });
    }

    if (selectedCollection && selectedCollection !== "default") {
      filteredPrices = filteredPrices.filter((price) => {
        return (
          price?.productId?.collection_id?._id?.toString() ===
          selectedCollection
        );
      });
    }

    return res.status(200).json({
      status: 200,
      message: "Price list",
      data: filteredPrices,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const PriceList = asyncHandler(async (req, res) => {
  try {
    let RegionaltList = await Price.find({ price_type: "regional" })
      .populate([
        {
          path: "createdBy",
          select: "name role",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "productId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    let DistributorList = await Price.find({ price_type: "distributor" })
      .populate([
        {
          path: "createdBy",
          select: "name role",
        },
        {
          path: "distributorId",
          select: " ",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "productId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    let NationalList = await Price.find({ price_type: "national" })
      .populate([
        {
          path: "createdBy",
          select: "name role",
        },
        {
          path: "productId",
          select: "",
        },
      ])
      .sort({ _id: -1 });

    return res.status(201).json({
      status: 201,
      message: "Product Price list",
      RegionalPrice: RegionaltList,
      DistributorPrice: DistributorList,
      NationalPrice: NationalList,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

// console.time("PRICING_API_TOTAL");
const ProductPricing = asyncHandler(async (req, res) => {
  try {
    let distributorId = req.query.distributorId;
    let regionId = req.query.regionId;

    let priceList = await Price.find({
      productId: req.params.productId,
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
      .sort({ _id: -1 });

    // if regionId and distributorId are not provided - include national prices
    if (!regionId && !distributorId) {
      const filteredPrices = priceList.filter((price) => {
        const effectiveDate = moment(price?.effective_date)
          .tz("Asia/Kolkata")
          .startOf("day")
          .toDate();
        const nowDateTime = moment().tz("Asia/Kolkata").toDate();

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
      });

      return res.status(201).json({
        status: 201,
        message: "Product Price list",
        data: filteredPrices,
      });
    }

    // if regionId is provided and distributorId is not provided
    if (regionId && !distributorId) {
      const region = await Region.findOne({ _id: regionId });

      if (!region) {
        return res.status(400).json({
          status: 400,
          message: "Region not found",
        });
      }

      const regionalPrices = priceList.filter((price) => {
        const effectiveDate = moment(price?.effective_date)
          .tz("Asia/Kolkata")
          .startOf("day")
          .toDate();
        const nowDateTime = moment().tz("Asia/Kolkata").toDate();

        // Check if expiresAt exists and handle it accordingly
        if (price?.expiresAt) {
          const expiresAt = moment(price?.expiresAt)
            .tz("Asia/Kolkata")
            .endOf("day")
            .toDate();

          return (
            price?.price_type === "regional" &&
            price?.regionId?._id?.toString() === regionId &&
            moment(effectiveDate).isSameOrBefore(nowDateTime) &&
            moment(expiresAt).isSameOrAfter(nowDateTime)
          );
        } else {
          return (
            price?.price_type === "regional" &&
            price?.regionId?._id?.toString() === regionId &&
            moment(effectiveDate).isSameOrBefore(nowDateTime)
          );
        }
      });

      const nationalPrices = priceList.filter((price) => {
        const effectiveDate = moment(price?.effective_date)
          .tz("Asia/Kolkata")
          .startOf("day")
          .toDate();
        const nowDateTime = moment().tz("Asia/Kolkata").toDate();

        // Check if expiresAt exists and handle it accordingly
        if (price?.expiresAt) {
          const expiresAt = moment(price?.expiresAt)
            .tz("Asia/Kolkata")
            .endOf("day")
            .toDate();

          return (
            price?.price_type === "national" &&
            moment(effectiveDate).isSameOrBefore(nowDateTime) &&
            moment(expiresAt).isSameOrAfter(nowDateTime)
          );
        } else {
          return (
            price?.price_type === "national" &&
            moment(effectiveDate).isSameOrBefore(nowDateTime)
          );
        }
      });

      // Priority: regional > national
      const finalPrices =
        regionalPrices.length > 0 ? regionalPrices : nationalPrices;

      return res.status(201).json({
        status: 201,
        message: "Product Price list",
        data: finalPrices,
      });
    }

    const distributor = await Distributor.findOne({ _id: distributorId });

    if (!distributor) {
      return res.status(400).json({
        status: 400,
        message: "Distributor not found",
      });
    }

    // Assign distributor's regionId if not provided
    if (!regionId) {
      regionId = distributor.regionId.toString();
    }

    const region = await Region.findOne({ _id: regionId });

    if (!region) {
      return res.status(400).json({
        status: 400,
        message: "Region not found",
      });
    }

    const nowDateTime = moment().tz("Asia/Kolkata").toDate();

    const distributorPrices = priceList.filter((price) => {
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
          price?.price_type === "distributor" &&
          price?.distributorId?._id?.toString() === distributorId?.toString() &&
          price?.regionId?._id?.toString() === regionId &&
          moment(effectiveDate).isSameOrBefore(nowDateTime) &&
          moment(expiresAt).isSameOrAfter(nowDateTime)
        );
      } else {
        return (
          price?.price_type === "distributor" &&
          price?.distributorId?._id?.toString() === distributorId?.toString() &&
          price?.regionId?._id?.toString() === regionId &&
          moment(effectiveDate).isSameOrBefore(nowDateTime)
        );
      }
    });

    const regionalPrices = priceList.filter((price) => {
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
          price?.price_type === "regional" &&
          price?.regionId?._id?.toString() === regionId &&
          moment(effectiveDate).isSameOrBefore(nowDateTime) &&
          moment(expiresAt).isSameOrAfter(nowDateTime)
        );
      } else {
        return (
          price?.price_type === "regional" &&
          price?.regionId?._id?.toString() === regionId &&
          moment(effectiveDate).isSameOrBefore(nowDateTime)
        );
      }
    });

    const nationalPrices = priceList.filter((price) => {
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
          price?.price_type === "national" &&
          moment(effectiveDate).isSameOrBefore(nowDateTime) &&
          moment(expiresAt).isSameOrAfter(nowDateTime)
        );
      } else {
        return (
          price?.price_type === "national" &&
          moment(effectiveDate).isSameOrBefore(nowDateTime)
        );
      }
    });

    // Priority: distributor > regional > national
    let finalPrices = distributorPrices;
    if (finalPrices.length === 0) {
      finalPrices = regionalPrices;
    }
    if (finalPrices.length === 0) {
      finalPrices = nationalPrices;
    }
    // console.timeEnd("PRICING_API_TOTAL");
    return res.status(200).json({
      status: 200,
      message: "Product Price list",
      data: finalPrices,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  addPrice,
  addDBPriceByDB,
  priceDetail,
  updatePrice,
  PriceALList,
  PriceList,
  PriceALListPaginated,
  pricingStatusBulkUpdate,
  PricingAllListReport,
  ProductPricing,
};
