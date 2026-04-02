const UserPermission = require("../../models/user_Access/userPagePermission");

const getUserPermission = async (req, res) => {
  try {
    const { userId } = req.params;

    const permission = await UserPermission.findOne({ user: userId });

    if (!permission) {
      return res.status(200).json({
        success: true,
        data: {},
        role: null, 
      });
    }

    const formatted = {};

    permission.modules.forEach((module) => {
      formatted[module.module] = {};

      module.pages.forEach((page) => {
        formatted[module.module][page.page] = {
          pageName: page.pageName,
          pageSlug: page.pageSlug,
          view: page.view,
          create: page.create,
          update: page.update,
          delete: page.delete,
        };
      });
    });

    res.status(200).json({
      success: true,
      role: permission.role,
      data: formatted,
    });

  } catch (error) {
    console.error("Get Permission Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};


module.exports = { getUserPermission };
