const asyncHandler = require("express-async-handler");
const Distributor = require("../models/distributor.model.js");
const Password = require("../models/password.model.js");
const generateToken = require("../utils/generateToken.js");
const bcrypt = require("bcryptjs");
const { CLIENT_URL } = require("../config/server.config.js");
const sendEmail = require("../utils/sendEmail.js");
const DbBank = require("../models/dbBank.model");

/* =======================
   ✅ ONLY ADDITION
======================= */
const Beat = require("../models/beat.model");
/* ======================= */

const getMe = asyncHandler(async (req, res) => {
  try {
    res.status(200).json({
      status: 200,
      data: {
        ...req?.user?._doc,
      },
    });
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

const addDistributor = asyncHandler(async (req, res) => {
  try {
    let {
      name,
      email,
      password,
      role,
      RBPSchemeMapped,
      dbCode,
      regionId,
      stateId,
      area,
      status,
      address1,
      address2,
      sbu,
      phone,
      gst_no,
      pan_no,
      access,
      ownerName,
      district,
      dayOff,
      city,
      pincode,
      brandId,
      primaryInvoiceType,
      oldDate,
    } = req.body;

    const distributorExists = await Distributor.findOne({
      $or: [{ email }, { dbCode }],
    });

    if (distributorExists) {
      res.status(400);
      throw new Error("Distributor already exists");
    }

    if (!password) {
      password = "123456";
    }

    let genPassword = "secret";

    const distributor = await Distributor.create({
      name,
      email,
      dbCode,
      password,
      genPassword: genPassword,
      role,
      RBPSchemeMapped,
      regionId,
      stateId,
      area,
      status,
      avatar: `https://img.icons8.com/officel/80/user.png`,
      createdBy: req.user._id,
      address1,
      address2,
      sbu,
      phone,
      gst_no,
      pan_no,
      access,
      ownerName,
      district,
      dayOff,
      city,
      pincode,
      brandId,
      primaryInvoiceType,
      oldDate,
      RBPSchemeMappedHistory: [
        {
          value: RBPSchemeMapped || "yes",
          updatedAt: new Date(),
          updatedBy: req.user._id,
        },
      ],
      RBPSchemeMappedLastUpdated: new Date(),
    });

    await DbBank.create({
      distributorId: distributor._id,
    });

    let passwordData = new Password({
      userId: distributor?._id,
      password: password,
      genPassword: genPassword,
    });

    await passwordData.save();

    if (distributor) {
      res.status(201).json({
        status: 201,
        data: {
          _id: distributor._id,
          name: distributor.name,
          email: distributor.email,
          avatar: distributor.avatar,
          role: distributor.role,
          RBPSchemeMapped: distributor.RBPSchemeMapped,
          RBPSchemeMappedLastUpdated:
            distributor.RBPSchemeMappedLastUpdated,
          regionId: distributor.regionId,
          stateId: distributor.stateId,
          area: distributor.area,
          status: distributor.status,
          createdBy: distributor.createdBy,
          address1: distributor.address1,
          address2: distributor.address2,
          sbu: distributor.sbu,
          phone: distributor.phone,
          gst_no: distributor.gst_no,
          pan_no: distributor.pan_no,
          access: distributor.access,
          ownerName: distributor.ownerName,
          district: distributor.district,
          dayOff: distributor.dayOff,
          city: distributor.city,
          pincode: distributor.pincode,
          brandId: distributor.brandId,
          primaryInvoiceType: distributor.primaryInvoiceType,
          oldDate: distributor.oldDate,
        },
      });
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const loginUser = asyncHandler(async (req, res) => {
  try {
    const { dbCode, password } = req.body;

    const user = await Distributor.findOne({ dbCode })
      .populate("createdBy")
      .populate("regionId")
      .populate("stateId");

    if (user) {
      const isMatchPassword = await bcrypt.compare(password, user.password);
      const isMatchGenPassword = await bcrypt.compare(
        password,
        user.genPassword
      );

      if (isMatchPassword || isMatchGenPassword) {
        const token = generateToken(user._id);

        return res.status(200).json({
          status: 200,
          data: {
            _id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
            RBPSchemeMapped: user.RBPSchemeMapped,
            createdBy: user.createdBy,
            oldDate: user.oldDate,
            token: token,
            regionId: user.regionId,
            stateId: user.stateId,
            area: user.area,
            status: user.status,
            address1: user.address1,
            address2: user.address2,
            dbCode: user.dbCode,
            sbu: user.sbu,
            phone: user.phone,
            gst_no: user.gst_no,
            pan_no: user.pan_no,
            access: user.access,
            loginAs: isMatchPassword ? "Distributor" : "Admin",
            ownerName: user?.ownerName,
            district: user?.district,
            dayOff: user?.dayOff,
            city: user?.city,
            pincode: user?.pincode,
            brandId: user?.brandId,
          },
        });
      } else {
        res.status(401);
        throw new Error("Invalid dbCode or password");
      }
    } else {
      res.status(401);
      throw new Error("Invalid dbCode or password");
    }
  } catch (error) {
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

const disListdata = asyncHandler(async (req, res) => {
  try {
    /* ============================
       1️⃣ FETCH DISTRIBUTORS
    ============================ */
    const distributors = await Distributor.find({})
      .populate([
        { path: "createdBy" },
        {
          path: "regionId",
          select: "_id name code stateId",
          populate: {
            path: "stateId",
            select: "_id slug alphaCode",
          },
        },
        {
          path: "stateId",
          select: "_id slug alphaCode name",
        },
        { path: "district" },
        { path: "brandId" },
      ])
      .select("-password -genPassword")
      .sort({ _id: -1 })
      .lean();

    /* ============================
       2️⃣ FETCH BEATS
    ============================ */
    const beats = await Beat.find({ status: true })
      .populate({
        path: "regionId",
        select: "_id stateId",
        populate: {
          path: "stateId",
          select: "_id slug alphaCode",
        },
      })
      .select("_id name code distributorId regionId")
      .lean();

    /* ============================
       3️⃣ BUILD BEAT MAPS
    ============================ */
    const byDistributor = {};
    const byRegion = {};
    const byState = {};

    for (const beat of beats) {
      // 1️⃣ Distributor mapping
      if (Array.isArray(beat.distributorId)) {
        for (const disId of beat.distributorId) {
          const key = disId.toString();
          if (!byDistributor[key]) byDistributor[key] = [];
          byDistributor[key].push(beat);
        }
      }

      // 2️⃣ Region mapping
      if (beat.regionId?._id) {
        const key = beat.regionId._id.toString();
        if (!byRegion[key]) byRegion[key] = [];
        byRegion[key].push(beat);
      }

      // 3️⃣ State mapping (slug / alphaCode)
      const stateKey =
        beat.regionId?.stateId?.slug ||
        beat.regionId?.stateId?.alphaCode;

      if (stateKey) {
        if (!byState[stateKey]) byState[stateKey] = [];
        byState[stateKey].push(beat);
      }
    }

    /* ============================
       4️⃣ ATTACH BEATS TO DISTRIBUTORS
    ============================ */
    const result = distributors.map((dis) => {
      let assignedBeats = [];

      // Priority 1️⃣: Direct distributor beats
      if (byDistributor[dis._id.toString()]?.length) {
        assignedBeats = byDistributor[dis._id.toString()];
      }
      // Priority 2️⃣: Region beats
      else if (byRegion[dis.regionId?._id?.toString()]?.length) {
        assignedBeats = byRegion[dis.regionId._id.toString()];
      }
      // Priority 3️⃣: State beats (WB / RJ / OR)
      else if (byState[dis.stateId?.slug]?.length) {
        assignedBeats = byState[dis.stateId.slug];
      }

      return {
        ...dis,
        beats: assignedBeats.map((b) => ({
          _id: b._id,
          name: b.name,
          code: b.code,
        })),
      };
    });

    /* ============================
       5️⃣ RESPONSE
    ============================ */
    res.status(200).json({
      status: 200,
      message: "Distributor list fetched successfully",
      data: result,
    });
  } catch (error) {
    console.error("Distributor List Error:", error);
    res.status(500);
    throw new Error(error?.message || "Something went wrong");
  }
});



const updateDistributor = asyncHandler(async (req, res) => {
  const { _id } = req.body;

  const distributor = await Distributor.findById(_id);

  if (!distributor) {
    res.status(404);
    throw new Error("Distributor not found");
  }

  distributor.name = req.body.name ?? distributor.name;
  distributor.address1 = req.body.address1 ?? distributor.address1;
  distributor.address2 = req.body.address2 ?? distributor.address2;
  distributor.phone = req.body.phone ?? distributor.phone;
  distributor.gst_no = req.body.gst_no ?? distributor.gst_no;
  distributor.pan_no = req.body.pan_no ?? distributor.pan_no;
  distributor.email = req.body.email ?? distributor.email;
  distributor.avatar = req.body.avatar ?? distributor.avatar;
  distributor.status = req.body.status ?? distributor.status;
  distributor.sbu = req.body.sbu ?? distributor.sbu;
  distributor.role = req.body.role ?? distributor.role;
  distributor.RBPSchemeMapped =
    req.body.RBPSchemeMapped ?? distributor.RBPSchemeMapped;
  distributor.area = req.body.area ?? distributor.area;
  distributor.ownerName = req.body.ownerName ?? distributor.ownerName;
  distributor.dayOff = req.body.dayOff ?? distributor.dayOff;
  distributor.city = req.body.city ?? distributor.city;
  distributor.pincode = req.body.pincode ?? distributor.pincode;
  distributor.brandId = req.body.brandId ?? distributor.brandId;
  distributor.stateId = req.body.stateId ?? distributor.stateId;
  distributor.regionId = req.body.regionId ?? distributor.regionId;
  distributor.oldDate = req.body.oldDate ?? distributor.oldDate;
  distributor.primaryInvoiceType =
    req.body.primaryInvoiceType ?? distributor.primaryInvoiceType;

  const updatedDistributor = await distributor.save();

  const token = generateToken(updatedDistributor._id);

  const resultDistributor = {
    ...updatedDistributor._doc,
    token,
  };

  delete resultDistributor.password;
  delete resultDistributor.genPassword;

  res.status(200).json({
    status: 200,
    data: resultDistributor,
  });
});

const sendCredentialEmail = asyncHandler(async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await Distributor.findById(userId);

    if (user) {
      const passwordRecord = await Password.findOne({ userId });

      const loginUrl = `${CLIENT_URL}/sign-in?mode=distributor&email=${user.email}&password=${passwordRecord.password}`;

      await sendEmail({
        email: user.email,
        subject: "Welcome to RUPA DMS",
        htmlMessage: loginUrl,
      });

      res.status(200).json({
        status: 200,
        message: "Email sent successfully",
      });
    } else {
      res.status(404);
      throw new Error("User not found");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

const distributorByRegion = asyncHandler(async (req, res) => {
  try {
    const distributor = await Distributor.find({
      regionId: req.params.regId,
    })
      .populate([
        { path: "createdBy", select: "" },
        { path: "regionId", select: "" },
        { path: "stateId", select: "" },
        { path: "district", select: "" },
        { path: "brandId", select: "" },
      ])
      .sort({ _id: -1 })
      .select("-password -genPassword");

    return res.status(201).json({
      status: 201,
      message: "All Distributor list",
      data: distributor,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  getMe,
  addDistributor,
  loginUser,
  disListdata,
  updateDistributor,
  sendCredentialEmail,
  distributorByRegion,
};
