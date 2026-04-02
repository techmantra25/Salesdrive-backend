const Page = require("../../models/user_Access/addPage.mode"); // keep (not used)
const PageMaster = require("../../models/user_Access/pageSchema");
const UserPermission = require("../../models/user_Access/userPagePermission");
const User = require("../../models/user.model");

// ==============================
// CREATE PAGE (FINAL)
// ==============================
const createPage = async (req, res) => {
  try {
    const { module, page, slug } = req.body;

    console.log("Incoming body:", req.body); // DEBUG

    // ==============================
    // 🔴 VALIDATION
    // ==============================
    if (!module || !page || !slug) {
      return res.status(400).json({
        success: false,
        message: "Module, Page and Slug are required",
      });
    }

    // ==============================
    // 🔴 DUPLICATE CHECK (ONLY MASTER)
    // ========================
    const existingMaster = await PageMaster.findOne({ slug });

    if (existingMaster) {
      return res.status(400).json({
        success: false,
        message: "Slug already exists",
      });
    }

    // ==============================
    // 🟡 AUTO ORDER (FROM MASTER)
    // ==============================
    const pages = await PageMaster.find({
      module,
      isActive: true,
    }).select("order");

    const maxOrder = pages.reduce((max, p) => {
      return p.order > max ? p.order : max;
    }, 0);

    const finalOrder = maxOrder + 1;

    // ==============================
    // 🟢 CREATE IN PAGE MASTER ONLY
    // ==============================
    const newPage = await PageMaster.create({
      module,
      page,
      slug,
      order: finalOrder,
      isActive: true,
    });

    // ==============================
    // 🔥 ADMIN FULL PERMISSION
    // ==============================
    const adminUsers = await User.find({ role: "admin" }).select("_id");

    for (const admin of adminUsers) {
      let userPerm = await UserPermission.findOne({ user: admin._id });

      if (!userPerm) {
        userPerm = await UserPermission.create({
          user: admin._id,
          role: "admin",
          modules: [],
        });
      }

      let moduleIndex = userPerm.modules.findIndex(
        (m) => m.module === module
      );

      if (moduleIndex === -1) {
        userPerm.modules.push({
          module,
          pages: [],
        });
        moduleIndex = userPerm.modules.length - 1;
      }

      const alreadyExists = userPerm.modules[moduleIndex].pages.find(
        (p) => p.pageSlug === slug
      );

      if (!alreadyExists) {
        userPerm.modules[moduleIndex].pages.push({
          page: newPage._id,
          pageName: newPage.page,
          pageSlug: newPage.slug,
          view: true,
          create: true,
          update: true,
          delete: true,
        });
      }

      await userPerm.save();
    }

    // ==============================
    // ✅ RESPONSE
    // ==============================
    return res.status(201).json({
      success: true,
      message: `Page created with order ${finalOrder}`,
      data: newPage,
    });

  } catch (error) {
    console.error("❌ Create Page Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = { createPage };