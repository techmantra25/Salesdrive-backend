const PageMaster = require("../../models/user_Access/pageSchema");

const getAllPages = async (req, res) => {
  try {
    const pages = await PageMaster.find({ isActive: true })
      .sort({ module: 1, order: 1 })
      .lean();

    const groupedData = pages.reduce((acc, page) => {
      if (!acc[page.module]) {
        acc[page.module] = {
          module: page.module,
          pages: [],
        };
      }

      acc[page.module].pages.push({
        _id: page._id,
        page: page.page,
        slug: page.slug,
        permissions: page.permissions,
      });

      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: Object.values(groupedData), 
    });

  } catch (error) {
    console.error("Get Grouped Pages Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = { getAllPages };
