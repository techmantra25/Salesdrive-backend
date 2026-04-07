const asyncHandler = require("express-async-handler");
const Distributor = require("../models/distributor.model.js");
const Password = require("../models/password.model.js");
const generateToken = require("../utils/generateToken.js");
const bcrypt = require("bcryptjs");
const { CLIENT_URL } = require("../config/server.config.js");
const sendEmail = require("../utils/sendEmail.js");
const DbBank = require("../models/dbBank.model");

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
      allowRLPEdit,
    } = req.body;

    const distributorExists = await Distributor.findOne({
      $or: [{ email }, { dbCode }],
    });

    if (distributorExists) {
      res.status(400);
      throw new Error("Distributor already exists");
    }

    if (!password) {
      // password = Math.random().toString(36).slice(-8);
      password = "123456";
    }

    // let genPassword = Math.random().toString(36).slice(-8);
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
      allowRLPEdit,
      // Initialize RBPSchemeMapped history
      RBPSchemeMappedHistory: [
        {
          value: RBPSchemeMapped || "yes",
          updatedAt: new Date(),
          updatedBy: req.user._id,
        },
      ],
      RBPSchemeMappedLastUpdated: new Date(),
    });

    const bank = await DbBank.create({
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
          RBPSchemeMappedLastUpdated: distributor.RBPSchemeMappedLastUpdated,
          regionId: distributor.regionId,
          stateId: distributor.stateId,
          area: distributor.area,
          status: distributor.status,
          avatar: distributor.avatar,
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
          allowRLPEdit: distributor.allowRLPEdit,
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

    // Find the user by dbCode and populate the necessary fields
    const user = await Distributor.findOne({ dbCode })
      .populate("createdBy")
      .populate("regionId")
      .populate("stateId");

    // If the user is found
    if (user) {
      // Compare the provided password with the stored password and genPassword
      const isMatchPassword = await bcrypt.compare(password, user.password);
      const isMatchGenPassword = await bcrypt.compare(
        password,
        user.genPassword,
      );

      // If either password or genPassword matches
      if (isMatchPassword || isMatchGenPassword) {
        const token = generateToken(user._id); // Generate a token for the user
        const loginAs = isMatchPassword ? "Distributor" : "Admin";

        // Set cookie with token
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        res.cookie("DBToken", token, {
          httpOnly: true,
          secure: "true",
          sameSite: 'none',
          path: "/",
          maxAge: 30 * 24 * 60 * 60 * 1000,
          priority: "high",
        });

        // Send a successful response with user details (without token in body)
        const responseData = {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          RBPSchemeMapped: user.RBPSchemeMapped,
          createdBy: user.createdBy,
          oldDate: user.oldDate,
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
          loginAs: loginAs,
          goDown: user?.goDown,
          openingStock: user?.openingStock,
          ownerName: user?.ownerName,
          district: user?.district,
          dayOff: user?.dayOff,
          city: user?.city,
          pincode: user?.pincode,
          brandId: user?.brandId,
          allowRLPEdit: user?.allowRLPEdit,
        };

        // Only include portal lock status for Distributor login
        // Admin login (genPassword) can access portal even if locked
        if (loginAs === "Distributor") {
          responseData.isPortalLocked = user?.isPortalLocked || false;
          responseData.portalLockReason = user?.portalLockReason || null;
          responseData.portalLockedAt = user?.portalLockedAt || null;
        }

        return res.status(200).json({
          status: 200,
          data: responseData,
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
    // Handle any errors and send a response with the error message
    res.status(401);
    throw new Error(error?.message || "Something went wrong");
  }
});

const logoutDistributor = asyncHandler(async (req, res) => {
  try {
    res.cookie("DBToken", "", {
      httpOnly: true,
      secure: "true",
      sameSite: 'none',
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });

    return res.status(200).json({
      status: 200,
      message: "Logged out successfully",
    });
  } catch (error) {
    res.status(500);
    throw new Error(error?.message || "Something went wrong");
  }
});

const disList = asyncHandler(async (req, res) => {
  try {
    // Fetch the distributor list, populate the required fields, sort by _id in descending order, and exclude the password and genPassword fields
    const distributorList = await Distributor.find({})
      .populate([
        {
          path: "createdBy",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "district",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
      ])
      .sort({ _id: -1 })
      .select("-password -genPassword"); // Exclude password and genPassword fields

    // Return the distributor list in the response
    return res.status(201).json({
      status: 201,
      message: "All Distributors list fetched successfully",
      data: distributorList,
    });
  } catch (error) {
    // Handle any errors and send a response with the error message
    res.status(400);
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

  // Set the updatedBy field for tracking who updated RBPSchemeMapped
  // if (
  //   req.body.RBPSchemeMapped &&
  //   req.body.RBPSchemeMapped !== distributor.RBPSchemeMapped
  // ) {
  //   distributor._updatedBy = req.user._id;
  // }

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
  if (req.body.password) {
    distributor.password = req.body.password;
  }
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

  if ("openingStock" in req.body) {
    distributor.openingStock = req.body.openingStock;
  }

  if ("allowRLPEdit" in req.body) {
    distributor.allowRLPEdit = req.body.allowRLPEdit;
  }

  const updatedDistributor = await distributor.save();

  // Only update Password collection if password is changed
  if (req.body.password) {
    let updateParam = {
      userId: distributor._id,
      password: req.body.password,
    };

    await Password.findOneAndUpdate({ userId: distributor._id }, updateParam, {
      new: true,
    });
  }

  const token = generateToken(updatedDistributor._id);

  const resultDistributor = {
    ...updatedDistributor._doc,
    token,
  };

  if (req?.body?.loginAs === "Admin") {
    resultDistributor.loginAs = "Admin";
  }

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
      const passwordRecord = await Password.findOne({
        userId: userId,
      });

      if (!passwordRecord) {
        res.status(404);
        throw new Error("Password not found for the user");
      }

      const name = user.name;
      const email = user.email;
      const password = passwordRecord.password;

      let loginUrl = `${CLIENT_URL}/sign-in?mode=distributor&email=${email}&password=${password}`;

      let htmlMessage = `<body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
            <tr>
                <td style="text-align: center; padding: 10px 0;">
                    <h1 style="color: #333333;">RUPA DMS</h1>
                </td>
            </tr>
            <tr>
                <td style="padding: 20px;">
                    <h2 style="color: #333333;">Welcome to RUPA DMS</h2>
                    <p style="color: #555555; line-height: 1.5;">
                        Hello ${name},
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        Your distributor account has been successfully created. Below are your account details:
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        <strong>Email:</strong> ${email}<br>
                        <strong>Password:</strong> ${password}
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        You can log in to your account using the button below:
                    </p>
                    <p style="text-align: center; padding: 20px 0;">
                        <a href=${loginUrl} style="background-color: #28a745; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 5px;">Login</a>
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        If the button above does not work, copy and paste the following link into your browser:
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        <a href=${loginUrl} style="color: #28a745;">${loginUrl}</a>
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        If you have any questions or need assistance, please contact our support team.
                    </p>
                    <p style="color: #555555; line-height: 1.5;">
                        Thanks,<br>
                        The RUPA DMS Team
                    </p>
                </td>
            </tr>
            <tr>
                <td style="text-align: center; padding: 20px 0; color: #999999; font-size: 12px;">
                    &copy; 2024 RUPA DMS. All rights reserved.
                </td>
            </tr>
        </table>
    </body>`;

      await sendEmail({
        email: user.email,
        subject: "Welcome to RUPA DMS",
        htmlMessage,
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
    const distributor = await Distributor.find({ regionId: req.params.regId })
      .populate([
        {
          path: "createdBy",
          select: "",
        },
        {
          path: "regionId",
          select: "",
        },
        {
          path: "stateId",
          select: "",
        },
        {
          path: "district",
          select: "",
        },
        {
          path: "brandId",
          select: "",
        },
      ])
      .sort({ _id: -1 })
      .select("-password -genPassword"); // Exclude password and genPassword fields

    return res.status(201).json({
      status: 201,
      message: "All Distributor list",
      data: distributor,
    });
  } catch (error) {
    // Handle any errors and send a response with the error message
    res.status(400);
    throw new Error(error?.message || "Something went wrong");
  }
});

module.exports = {
  getMe,
  addDistributor,
  loginUser,
  logoutDistributor,
  disList,
  updateDistributor,
  sendCredentialEmail,
  distributorByRegion,
};
