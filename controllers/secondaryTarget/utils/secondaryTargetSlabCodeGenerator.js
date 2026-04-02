const SecondaryTargetSlab = require("../../../models/secondaryTarget.model");

const generateSlabCode = async (maxAttempts = 10) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = `SLB${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;

    const exists = await SecondaryTargetSlab.exists({ slabCode: candidate });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error(
    "Failed to generate a unique slab code after maximum attempts. Please retry.",
  );
};

module.exports = { generateSlabCode };
