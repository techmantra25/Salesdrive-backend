const PrimaryTarget = require("../../../models/primaryTarget.model");
const PrimaryTargetSlab = require("../../../models/primaryTargetSlab.model");
const Product = require("../../../models/product.model");
const Invoice = require("../../../models/invoice.model");

const updatePrimaryTargetAchievement = async (payload) => {
  const {
    distributorId,
    billDate,
    totalBillValue,
    lineItems,
  } = payload;

  try {

    const billDateUTC = new Date(billDate);

    console.log("🎯 Primary Target Payload:", {
      distributorId,
      billDate: billDateUTC,
      totalBillValue,
      items: lineItems?.length || 0,
    });

    const matchingTargets = await PrimaryTarget.find({
      distributorId,
      approval_status: "Approved",
      target_start_date: { $lte: billDateUTC },
      target_end_date: { $gte: billDateUTC },
    });

    if (!matchingTargets || matchingTargets.length === 0) {
      console.log("❌ No active primary target found for bill date");
      return;
    }

    /* 🔥 PRELOAD PRODUCTS (PERFORMANCE FIX) */
    const productIds = lineItems.map(i => i.product);
    const products = await Product.find({ _id: { $in: productIds } })
      .select("brand subBrand");

    const productMap = {};
    products.forEach(p => {
      productMap[p._id.toString()] = p;
    });

    for (const target of matchingTargets) {

      let achievementValue = 0;

      const brandIds = (target.brandId || []).map(id => id.toString());
      const subBrandIds = (target.subBrandId || []).map(id => id.toString());

      const isGlobal = brandIds.length === 0;
      const isBrandOnly = brandIds.length > 0 && subBrandIds.length === 0;
      const isBrandSubBrand = brandIds.length > 0 && subBrandIds.length > 0;

      /* --------------------------------------
         GLOBAL VALUE (DIRECT)
      -------------------------------------- */
      if (isGlobal && target.target_type === "value") {
        achievementValue = Number(totalBillValue || 0);
      } else {

        for (const item of lineItems) {

          const product = productMap[item.product.toString()];
          if (!product) continue;

          const productBrand = product.brand?.toString();
          const productSubBrand = product.subBrand?.toString();

          let isMatch = false;

          /* CASE 1 → GLOBAL */
          if (isGlobal) {
            isMatch = true;
          }

          /* CASE 2 → BRAND ONLY */
          else if (isBrandOnly) {
            if (productBrand && brandIds.includes(productBrand)) {
              isMatch = true;
            }
          }

          /* CASE 3 → BRAND + SUBBRAND */
          else if (isBrandSubBrand) {
            if (
              productBrand &&
              productSubBrand &&
              brandIds.includes(productBrand) &&
              subBrandIds.includes(productSubBrand)
            ) {
              isMatch = true;
            }
          }

          if (!isMatch) continue;

          if (target.target_type === "value") {
            achievementValue += Number(item.netAmount || 0);
          }

          if (target.target_type === "volume") {
            achievementValue += Number(item.receivedQty || 0);
          }
        }
      }

      if (achievementValue <= 0) continue;

      const updatedTarget = await PrimaryTarget.findByIdAndUpdate(
        target._id,
        { $inc: { achivedTarget: achievementValue } },
        { new: true }
      );

      /* 🔥 NEW: ADD TARGET ID TO INVOICE */
      await Invoice.findOneAndUpdate(
        {
          distributorId,
          date: billDateUTC,
        },
        {
          $addToSet: { targetIds: target._id },
        }
      );

      /* KEEP YOUR EXISTING SLAB LOGIC BELOW — NO CHANGE */

      const slab = await PrimaryTargetSlab.findOne({
        slab_type: updatedTarget.target_type,
        is_active: true,
        min_range: { $lte: updatedTarget.achivedTarget },
        max_range: { $gte: updatedTarget.achivedTarget },
      });

      if (!slab) {
        console.log("⚠️ No matching slab found for achieved target");
      } else {

        if (
          !updatedTarget.targetSlabId ||
          updatedTarget.targetSlabId.toString() !== slab._id.toString()
        ) {

          updatedTarget.targetSlabId = slab._id;
          await updatedTarget.save();

          console.log(
            `🏆 Slab Updated → ${slab.name} (${slab.min_range}–${slab.max_range})`
          );

        }

      }

      console.log(
        `✅ Primary Target Updated → ${updatedTarget.achivedTarget}`
      );

    }

    /* --------------------------------------------------
       ⚠️ YOUR EXISTING BUG BLOCK (KEPT AS-IS)
    -------------------------------------------------- */

    const slab = await PrimaryTargetSlab.findOne({
      slab_type: updatedTarget.target_type,
      is_active: true,
      min_range: { $lte: updatedTarget.achivedTarget },
      max_range: { $gte: updatedTarget.achivedTarget },
    });

    if (!slab) {
      console.log("⚠️ No matching slab found for achieved target");
    } else {

      if (
        !updatedTarget.targetSlabId ||
        updatedTarget.targetSlabId.toString() !== slab._id.toString()
      ) {

        updatedTarget.targetSlabId = slab._id;
        await updatedTarget.save();

        console.log(
          `🏆 Slab Updated → ${slab.name} (${slab.min_range}–${slab.max_range})`
        );

      } else {

        console.log("ℹ️ Slab already assigned, no change needed");

      }

    }

    console.log(
      `✅ Primary Target Updated → ${updatedTarget.achivedTarget}`
    );

  } catch (error) {

    console.error("❌ Error updating primary target:", error.message);

  }

};

module.exports = { updatePrimaryTargetAchievement };