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
      L1DiscountPercentage,
      L2DiscountPercentage,
      effective_date,
      distributorId,
    } = req.body;

    // Build query based on price type
    let queryFilter = {
      productId,
      price_type,
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
    const dateToday = new Date();

    if (price_type === "regional") {
      const activeNationalPrice = await Price.findOne({
        productId,
        price_type: "national",
        regionId: null,
        distributorId: null,
        status: true,
      })
        .sort({ effective_date: -1, createdAt: -1 })
        .select("mrp_price")
        .lean();

      if (!activeNationalPrice) {
        res.status(400);
        throw new Error("Active national price not found for this product");
      }

      if (Number(activeNationalPrice.mrp_price) !== Number(mrp_price)) {
        res.status(400);
        throw new Error("Regional MRP should match active national MRP");
      }
    }

    if (existingPrices.length > 0) {
      const latestPrice = existingPrices[0];
      const todayStart = moment(dateToday)
        .tz("Asia/Kolkata")
        .startOf("day")
        .toDate();

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
        const finalExpiresAt = price.expiresAt ?? expiresAt;
        price.expiresAt = finalExpiresAt;

        const isSameRegionalPrice =
          price.price_type === "regional" &&
          price_type === "regional" &&
          String(price.regionId || "") === String(regionId || "") &&
          !price.distributorId;
        const isSameNationalPrice =
          price.price_type === "national" &&
          price_type === "national" &&
          !price.regionId &&
          !price.distributorId;
        const isExpiredPrice = moment(finalExpiresAt)
          .tz("Asia/Kolkata")
          .isSameOrBefore(dateToday);
        const isPastNationalPrice =
          isSameNationalPrice &&
          moment(price.effective_date)
            .tz("Asia/Kolkata")
            .isBefore(todayStart, "day");

        if (
          finalExpiresAt &&
          ((isSameRegionalPrice && isExpiredPrice) || isPastNationalPrice)
        ) {
          price.status = false;
        }

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
      L1DiscountPercentage,
      L2DiscountPercentage,
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
      L1DiscountPercentage,
      L2DiscountPercentage,
      effective_date,
      distributorId,
    } = req.body;

    // Build query based on price type
    let queryFilter = {
      productId,
      price_type,
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
      const todayStart = moment(dateToday)
        .tz("Asia/Kolkata")
        .startOf("day")
        .toDate();

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
        const finalExpiresAt = price.expiresAt ?? expiresAt;
        price.expiresAt = finalExpiresAt;

        const isSameRegionalPrice =
          price.price_type === "regional" &&
          price_type === "regional" &&
          String(price.regionId || "") === String(regionId || "") &&
          !price.distributorId;
        const isSameNationalPrice =
          price.price_type === "national" &&
          price_type === "national" &&
          !price.regionId &&
          !price.distributorId;
        const isExpiredPrice = moment(finalExpiresAt)
          .tz("Asia/Kolkata")
          .isSameOrBefore(dateToday);
        const isPastNationalPrice =
          isSameNationalPrice &&
          moment(price.effective_date)
            .tz("Asia/Kolkata")
            .isBefore(todayStart, "day");

        if (
          finalExpiresAt &&
          ((isSameRegionalPrice && isExpiredPrice) || isPastNationalPrice)
        ) {
          price.status = false;
        }

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
      L1DiscountPercentage,
      L2DiscountPercentage,
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
    const productId = req.body.productId ?? priceData.productId?._id ?? priceData.productId;
    const mrpPrice = req.body.mrp_price ?? priceData.mrp_price;
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

    if (priceType === "regional") {
      const activeNationalPrice = await Price.findOne({
        productId,
        price_type: "national",
        regionId: null,
        distributorId: null,
        status: true,
      })
        .sort({ effective_date: -1, createdAt: -1 })
        .select("mrp_price")
        .lean();

      if (!activeNationalPrice) {
        res.status(400);
        throw new Error("Active national price not found for this product");
      }

      if (Number(activeNationalPrice.mrp_price) !== Number(mrpPrice)) {
        res.status(400);
        throw new Error("Regional MRP should match active national MRP");
      }
    }

    let priceList = await Price.findOneAndUpdate(
      { _id: req.params.priceId },
      {
        productId,
        price_type: priceType,
        regionId: regionId,
        mrp_price: mrpPrice,
        dlp_price: req.body.dlp_price ?? priceData.dlp_price,
        rlp_price: req.body.rlp_price ?? priceData.rlp_price,
        L1DiscountPercentage:
          req.body.L1DiscountPercentage ?? priceData.L1DiscountPercentage,
        L2DiscountPercentage:
          req.body.L2DiscountPercentage ??
          priceData.L2DiscountPercentage,
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
  return res.status(200).json({
    status: 200,
    message: "Server response: pricingStatusBulkUpdate controller is running",
  });
});


const InactivePriceByExpiredDate = asyncHandler(async (req, res) => {
  try {
    const todayStart = moment()
      .tz("Asia/Kolkata")
      .startOf("day")
      .toDate();

    const result = await Price.updateMany(
      {
        status: true,
        expiresAt: { $ne: null, $lt: todayStart },
      },
      { $set: { status: false } },
    );

    return res.status(200).json({
      status: 200,
      message: "Expired prices deactivated successfully",
      data: {
        todayStart,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
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

    // =========================
    // SORTING
    // =========================
    // Whitelist of fields the client is allowed to sort by.
    // Keys = value sent from frontend (?sortBy=...), values = actual schema path.
    // Populated/virtual fields (productId.name, regionId.name, etc.) are
    // deliberately excluded here since Mongoose's .sort() can't sort on
    // populated paths directly — that would need an aggregation pipeline.
    const SORTABLE_FIELDS = {
      code: "code",
      price_type: "price_type",
      mrp_price: "mrp_price",
      dlp_price: "dlp_price",
      rlp_price: "rlp_price",
      L1DiscountPercentage: "L1DiscountPercentage",
      L2DiscountPercentage: "L2DiscountPercentage",
      effective_date: "effective_date",
      expiresAt: "expiresAt",
      status: "status",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };

    const requestedSortBy = req.query.sortBy;
    const sortField = SORTABLE_FIELDS[requestedSortBy] || "_id";

    const requestedSortOrder = (req.query.sortOrder || "").toLowerCase();
    const sortOrder = requestedSortOrder === "asc" ? 1 : -1;

    const sortOptions = { [sortField]: sortOrder };

    // Tie-breaker so pagination order stays stable when many rows share
    // the same value for the chosen sort field.
    if (sortField !== "_id") {
      sortOptions._id = -1;
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
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    const filteredCount = await Price.countDocuments(query);
    const totalItems = await Price.countDocuments();
    const totalActivePrices = await Price.countDocuments({ status: true });

    return res.status(200).json({
      status: 200,
      message: "Price list",
      data: priceList,
      sort: {
        sortBy:
          requestedSortBy && SORTABLE_FIELDS[requestedSortBy]
            ? requestedSortBy
            : "_id",
        sortOrder: sortOrder === 1 ? "asc" : "desc",
      },
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
  InactivePriceByExpiredDate,
  PricingAllListReport,
  ProductPricing,
};