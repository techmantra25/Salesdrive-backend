const { Branch } = require("../../models/branch.model");

const listBranch = async (req, res) => {
  try {
    const distributorId = req.user._id;

    const branches = await Branch.find({
      distributorId: distributorId,
    }).populate("bank");
    res.status(200).json({ status: 200, data: branches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  listBranch,
};
