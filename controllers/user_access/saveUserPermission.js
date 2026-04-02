const UserPermission = require("../../models/user_Access/userPagePermission");
const PageMaster = require("../../models/user_Access/pageSchema");
const User = require("../../models/user.model");

const saveUserPermission = async (req, res) => {
  console.log("Save Permission Request Body:", req.body);

  try {
    const { userId } = req.body;
    const permissions = req.body.permissions || req.body.modules;

    if (!userId || !permissions || typeof permissions !== "object") {
      return res.status(400).json({
        success: false,
        message: "UserId and permissions are required",
      });
    }

    // ✅ ADDED: Get user role
    const userData = await User.findById(userId).select("role");

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const role = userData.role;

    // 🔥 STEP 1: Collect all pageIds
    const allPageIds = Object.values(permissions)
      .flatMap((module) => Object.keys(module));

    // 🔥 STEP 2: Fetch all pages in ONE query (optimized)
    const pagesFromDB = await PageMaster.find({
      _id: { $in: allPageIds },
    }).select("page slug");

    // 🔥 STEP 3: Convert to map for fast lookup
    const pageMap = {};
    pagesFromDB.forEach((p) => {
      pageMap[p._id.toString()] = p;
    });

    // 🔥 STEP 4: Convert frontend object → DB structure
    const modules = Object.keys(permissions).map((moduleName) => ({
      module: moduleName,
      pages: Object.keys(permissions[moduleName] || {}).map((pageId) => {
        const pageData = pageMap[pageId];

        if (!pageData) {
          throw new Error(`Page not found for ID: ${pageId}`);
        }

      return {
  page: pageId,
  pageName: pageData.page,
  pageSlug: pageData.slug,
  view: role === "admin" ? true : permissions[moduleName]?.[pageId]?.view || false,
  create: role === "admin" ? true : permissions[moduleName]?.[pageId]?.create || false,
  update: role === "admin" ? true : permissions[moduleName]?.[pageId]?.update || false,
  delete: role === "admin" ? true : permissions[moduleName]?.[pageId]?.delete || false,
};

      }),
    }));

    // 🔥 STEP 5: Upsert logic
    let existingPermission = await UserPermission.findOne({ user: userId });

    if (!existingPermission) {
      const newPermission = await UserPermission.create({
        user: userId,
        role: role,   // ✅ ADDED
        modules,
      });

      return res.status(201).json({
        success: true,
        message: "Permission created successfully",
        data: newPermission,
      });
    }

    existingPermission.role = role;   // ✅ ADDED
    existingPermission.modules = modules;
    await existingPermission.save();

    return res.status(200).json({
      success: true,
      message: "Permission updated successfully",
      data: existingPermission,
    });

  } catch (error) {
    console.error("Save Permission Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server Error",
    });
  }
};

module.exports = { saveUserPermission };
