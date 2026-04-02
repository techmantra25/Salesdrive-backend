const SecondaryTarget = require("../../../models/secondaryTarget.model");
const SecondaryTargetSlab = require("../../../models/secondaryTargetSlab.model");
const Product = require("../../../models/product.model");
const Order = require("../../../models/orderEntry.model");
const Bill = require("../../../models/bill.model");

// function to help us resolve the right slab for our target
const resolveSlabForTarget = async (target, totalAchievement) => {
  // if the target does not has no slab assigned to it currently then nothing
  if (!target.targetSlabId || target.targetSlabId.length === 0) {
    return null;
  }

  // fetch the slabs that belong to the target
  const mappedSlabs = await SecondaryTargetSlab.find({
    _id: { $in: target.targetSlabId },
    is_active: true,
  }).lean();

  // if there were no active slabs then we can not proceed forward in this case
  if (!mappedSlabs || mappedSlabs.length === 0) {
    return null;
  }
  const slabType = mappedSlabs[0].slab_type;

  //volume or vlaue slab type find in which slab range does the target's achivement fall in
  if (slabType === "volume" || slabType === "value") {
    return (
      mappedSlabs.find(
        (s) =>
          totalAchievement >= s.min_range && totalAchievement <= s.max_range,
      ) || null
    );
  }

  // percentage case -> calculate achivement pick the one that is closest but in upper bound not in lower bound
  if (slabType === "percentage") {
    const achievementPercentage =
      target.target > 0 ? (totalAchievement / target.target) * 100 : 0;

    console.log(`Achievement percentage: ${achievementPercentage.toFixed(2)}%`);

    //sort in ascendeing order and pick the last one because it will be the one that will suit best
    const qualifiedSlabs = mappedSlabs
      .sort((a, b) => a.perc_slab - b.perc_slab)
      .filter((s) => achievementPercentage >= s.perc_slab);

    return qualifiedSlabs.length > 0
      ? qualifiedSlabs[qualifiedSlabs.length - 1]
      : null;
  }
  return null;
};

// function to deal and getLineItemAchivement it return the value or volume achived from a single line item
const getLineItemAchievement = async (item, bill) => {
  // if the bill type is of the following two types then we can not be taking it in our achivement
  if (
    item.itemBillType === "Item Removed" ||
    item.itemBillType === "Stock out"
  ) {
    return null;
  }

  const productId = item.product?._id || item.product;
  const product = await Product.findById(productId)
    .select("brand subBrand no_of_pieces_in_a_box")
    .lean();

  if (!product) {
    console.log(`Product ${productId} not found in bill ${bill.billNo}`);
    return null;
  }

  //getting the value
  const value = Number(item.netAmt || 0);

  //getting the volume
  let volume = 0;
  const oderQty = Number(item.oderQty || 0); // i have not taken oder quantity by my own choice i am just matching it to the schema field(who ever is reading)
  if (oderQty > 0) {
    if (item.uom === "pcs") {
      volume = oderQty;
    } else if (item.uom === "box") {
      const piecesPerBox = Number(product.no_of_pieces_in_a_box || 0);
      if (piecesPerBox > 0) {
        volume = oderQty * piecesPerBox;
      }
    }
  }
  return { value, volume, product };
};

const updateSecondaryTargetAchievement = async (bill, userId) => {
  try {
    const order = await Order.findById(bill.orderId).select("createdAt").lean();

    // if  order not found against the bill abort
    if (!order) {
      console.log(`Order not found for bill ${bill.billNo}`);
      return;
    }

    // findi all matching secondary Targets for this retailer and distributor
    const matchingTargets = await SecondaryTarget.find({
      distributorId: userId,
      retailerId: bill.retailerId,
      start_date: { $lte: order.createdAt },
      end_date: { $gte: order.createdAt },
      is_active: true,
    }).lean();

    // if no matching target found then abort
    if (!matchingTargets || matchingTargets.length === 0) {
      console.log(`No matching secondary targets found `);
      return;
    }
    console.log(
      `Found ${matchingTargets.length} targets for bill ${bill.billNo}`,
    );

    const lineItemData = [];

    for (const item of bill.lineItems) {
      // BUG FIX: was (item.bill) — missing bill argument and wrong syntax
      const result = await getLineItemAchievement(item, bill);
      if (result) lineItemData.push(result);
    }

    // if no line item then return
    if (lineItemData.length === 0) {
      console.log(`No valid line item in bill`);
      return;
    }

    // update each matching target
    for (const target of matchingTargets) {
      try {
        const hasBrands = target.brandId && target.brandId.length > 0;
        const hasSubBrands = target.subBrandId && target.subBrandId.length > 0;

        const targetBrandsIds = hasBrands
          ? target.brandId.map((id) => id.toString())
          : []; //brand ids of the target

        const targetSubBrandIds = hasSubBrands
          ? target.subBrandId.map((id) => id.toString())
          : []; //sub brand ids of the target

        let achivementValue = 0;
        let achivementVolume = 0;

        for (const { product, value, volume } of lineItemData) {
          const productBrandId = product.brand?.toString();
          const productSubBrandId = product.subBrand?.toString();

          // case1 where there is no brand or sub-brand count every thing
          if (!hasBrands && !hasSubBrands) {
            achivementValue += value;
            achivementVolume += volume;
            continue;
          }

          // case 2 when brand + sub-brand is given on the target
          // match at brand level first — product must belong to one of the target brands
          // then if product also has a subBrand, it must be in the target subBrands
          // products without subBrand assigned still count as long as brand matches
          if (hasBrands && hasSubBrands) {
            if (productBrandId && targetBrandsIds.includes(productBrandId)) {
              if (
                !productSubBrandId ||
                targetSubBrandIds.includes(productSubBrandId)
              ) {
                achivementValue += value;
                achivementVolume += volume;
              }
            }
            continue;
          }

          // case 3 has brands only no sub brands
          if (hasBrands && !hasSubBrands) {
            if (productBrandId && targetBrandsIds.includes(productBrandId)) {
              achivementValue += value;
              achivementVolume += volume;
            }
            continue;
          }
        }

        // pick the right achivement based per the target
        const totalAchievement =
          target.target_type === "value" ? achivementValue : achivementVolume;

        if (totalAchievement <= 0) {
          console.log(
            `No achievement for target "${target.name}" in bill ${bill.billNo}`,
          );
          continue;
        }
        const newAchivedTarget = (target.achivedTarget || 0) + totalAchievement;

        // resolve the slab for this target
        const matchedSlab = await resolveSlabForTarget(
          { ...target, achivedTarget: newAchivedTarget },
          newAchivedTarget,
        );

        const updateObj = {
          $inc: { achivedTarget: totalAchievement },
          $set: { currentTargetSlabId: matchedSlab ? matchedSlab._id : null },
        };

        const updated = await SecondaryTarget.findByIdAndUpdate(
          target._id,
          updateObj,
          { new: true },
        );

        if (updated) {
          console.log(
            `✅ Target "${updated.name}" updated for bill ${bill.billNo}: +${totalAchievement} (${target.target_type}) → ${updated.achivedTarget}/${updated.target}${matchedSlab ? ` | Slab: ${matchedSlab.name}` : ""}`,
          );

          // Link this target to the bill on first successful update only
          // bill.targetId is a single reference so we only set it once
          if (!bill.targetId) {
            await Bill.findByIdAndUpdate(bill._id, {
              $set: { targetId: target._id },
            });
            bill.targetId = target._id; // update local reference to prevent re-setting on next loop iteration
            console.log(
              `🔗 Bill ${bill.billNo} linked to target "${updated.name}"`,
            );
          }
        }
      } catch (targetError) {
        console.error(
          `Error updating target "${target.name}" for bill ${bill.billNo}:`,
          targetError.message,
        );
      }
    }
  } catch (error) {
    console.error(
      `Error in updateSecondaryTargetAchievement for bill ${bill.billNo}:`,
      error.message,
    );
  }
};

const calculateHistoricalAchievement = async (secondaryTarget) => {
  try {
    const {
      _id,
      distributorId,
      retailerId,
      start_date,
      end_date,
      target_type,
      brandId,
      subBrandId,
      target,
    } = secondaryTarget;

    if (secondaryTarget.is_active === false) {
      console.log(
        `Target "${secondaryTarget.name}" is inactive — skipping historical calculation`,
      );
      return;
    }

    const hasBrands = brandId && brandId.length > 0;
    const hasSubBrands = subBrandId && subBrandId.length > 0;

    const targetBrandIds = hasBrands ? brandId.map((id) => id.toString()) : [];
    const targetSubBrandIds = hasSubBrands
      ? subBrandId.map((id) => id.toString())
      : [];

    console.log(
      `Calculating historical achievement for target: "${secondaryTarget.name}" | Type: ${
        !hasBrands && !hasSubBrands
          ? "No brand/subBrand (all items)"
          : hasBrands && hasSubBrands
            ? "Brand + SubBrand"
            : "Brand only"
      }`,
    );

    // Fetch all delivered bills for this retailer + distributor
    const deliveredBills = await Bill.find({
      distributorId,
      retailerId,
      status: "Delivered",
    })
      .populate({ path: "orderId", select: "createdAt" })
      .lean();

    if (!deliveredBills || deliveredBills.length === 0) {
      console.log(`No delivered bills found for retailer ${retailerId}`);
      return;
    }

    // Filter bills within the target date range
    const relevantBills = deliveredBills.filter((bill) => {
      if (!bill.orderId?.createdAt) return false;
      const orderDate = new Date(bill.orderId.createdAt);
      return (
        orderDate >= new Date(start_date) && orderDate <= new Date(end_date)
      );
    });

    if (relevantBills.length === 0) {
      console.log(`No bills in target date range for retailer ${retailerId}`);
      return;
    }

    console.log(`Processing ${relevantBills.length} relevant bills`);

    let totalValue = 0;
    let totalVolume = 0;

    for (const bill of relevantBills) {
      for (const item of bill.lineItems || []) {
        if (
          item.itemBillType === "Item Removed" ||
          item.itemBillType === "Stock out"
        ) {
          continue;
        }

        try {
          const productId = item.product?._id || item.product;
          const product = await Product.findById(productId)
            .select("brand subBrand no_of_pieces_in_a_box")
            .lean();

          if (!product) {
            console.warn(
              `Product ${productId} not found in bill ${bill.billNo}`,
            );
            continue;
          }

          const productBrandId = product.brand?.toString();
          const productSubBrandId = product.subBrand?.toString();

          // Type 1: No brand, no subBrand → count everything
          if (!hasBrands && !hasSubBrands) {
            totalValue += Number(item.netAmt || 0);

            const orderQty = Number(item.oderQty || 0);
            if (orderQty > 0) {
              if (item.uom === "pcs") {
                totalVolume += orderQty;
              } else if (item.uom === "box") {
                const piecesPerBox = Number(product.no_of_pieces_in_a_box || 0);
                if (piecesPerBox > 0) totalVolume += orderQty * piecesPerBox;
              }
            }
            continue;
          }

          // Type 2: Brand + SubBrand defined on target
          // product brand must match — if product also has subBrand it must match too
          // products without subBrand assigned still count as long as brand matches
          if (hasBrands && hasSubBrands) {
            if (productBrandId && targetBrandIds.includes(productBrandId)) {
              if (
                !productSubBrandId ||
                targetSubBrandIds.includes(productSubBrandId)
              ) {
                totalValue += Number(item.netAmt || 0);

                const orderQty = Number(item.oderQty || 0);
                if (orderQty > 0) {
                  if (item.uom === "pcs") {
                    totalVolume += orderQty;
                  } else if (item.uom === "box") {
                    const piecesPerBox = Number(
                      product.no_of_pieces_in_a_box || 0,
                    );
                    if (piecesPerBox > 0)
                      totalVolume += orderQty * piecesPerBox;
                  }
                }
              }
            }
            continue;
          }

          // Type 3: Brand only → match at brand level
          if (hasBrands && !hasSubBrands) {
            if (productBrandId && targetBrandIds.includes(productBrandId)) {
              totalValue += Number(item.netAmt || 0);

              const orderQty = Number(item.oderQty || 0);
              if (orderQty > 0) {
                if (item.uom === "pcs") {
                  totalVolume += orderQty;
                } else if (item.uom === "box") {
                  const piecesPerBox = Number(
                    product.no_of_pieces_in_a_box || 0,
                  );
                  if (piecesPerBox > 0) totalVolume += orderQty * piecesPerBox;
                }
              }
            }
            continue;
          }
        } catch (error) {
          console.error(
            `Error processing product in bill ${bill.billNo}:`,
            error.message,
          );
        }
      }
    }

    const totalAchievement = target_type === "value" ? totalValue : totalVolume;

    console.log(
      `Total ${target_type} achievement: ${totalAchievement}${target_type === "volume" ? " pcs" : " INR"}`,
    );

    if (totalAchievement <= 0) {
      console.log(`No valid achievement for target "${secondaryTarget.name}"`);
      return;
    }

    // Resolve slab from target's own mapped slabs
    const matchedSlab = await resolveSlabForTarget(
      { ...secondaryTarget, target },
      totalAchievement,
    );

    const updateObj = {
      achivedTarget: totalAchievement,
      currentTargetSlabId: matchedSlab ? matchedSlab._id : null,
    };

    const updated = await SecondaryTarget.findByIdAndUpdate(_id, updateObj, {
      new: true,
    });

    if (updated) {
      console.log(
        `✅ Historical achievement set for "${updated.name}": ${totalAchievement}/${updated.target} (${target_type})${matchedSlab ? ` | Slab: ${matchedSlab.name}` : " | No slab"}`,
      );

      // Link this target to each relevant bill that doesn't already have a targetId
      for (const bill of relevantBills) {
        if (!bill.targetId) {
          await Bill.findByIdAndUpdate(bill._id, {
            $set: { targetId: _id },
          });
          console.log(
            `🔗 Bill ${bill.billNo} linked to target "${updated.name}"`,
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `Error in calculateHistoricalAchievement for target "${secondaryTarget.name}":`,
      error.message,
    );
  }
};

// ── Recalculate achievement after target edit ─────────────────────────────────
// Separate from calculateHistoricalAchievement — handles all date range cases:
// - future start date → resets to 0 and stops (no bills to process)
// - past/current start date → resets and recalculates from bills in the new date range
const recalculateAfterTargetEdit = async (targetId) => {
  try {
    // ── Step 1: Reset achievement and slab ──────────────────────────────────
    await SecondaryTarget.findByIdAndUpdate(targetId, {
      achivedTarget: 0,
      currentTargetSlabId: null,
    });

    console.log(`🔄 Reset achievement for target ${targetId}`);

    // ── Step 2: Re-fetch latest saved target (with new brands/dates) ────────
    const target = await SecondaryTarget.findById(targetId).lean();
    if (!target) {
      console.log(`Target ${targetId} not found after reset`);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If start date is in the future there are no bills to calculate against
    // Achievement stays at 0 which is correct
    if (new Date(target.start_date) > today) {
      console.log(
        `Target "${target.name}" start date is in the future — achievement reset to 0, no recalculation needed`,
      );
      return;
    }

    // ── Step 3: Fetch delivered bills within the new date range ─────────────
    const {
      _id,
      distributorId,
      retailerId,
      start_date,
      end_date,
      target_type,
      brandId,
      subBrandId,
    } = target;

    const hasBrands = brandId && brandId.length > 0;
    const hasSubBrands = subBrandId && subBrandId.length > 0;

    const targetBrandIds = hasBrands ? brandId.map((id) => id.toString()) : [];
    const targetSubBrandIds = hasSubBrands
      ? subBrandId.map((id) => id.toString())
      : [];

    console.log(
      `Recalculating for target: "${target.name}" | Type: ${
        !hasBrands && !hasSubBrands
          ? "No brand/subBrand (all items)"
          : hasBrands && hasSubBrands
            ? "Brand + SubBrand"
            : "Brand only"
      }`,
    );

    const deliveredBills = await Bill.find({
      distributorId,
      retailerId,
      status: "Delivered",
    })
      .populate({ path: "orderId", select: "createdAt" })
      .lean();

    if (!deliveredBills || deliveredBills.length === 0) {
      console.log(`No delivered bills found — achievement stays at 0`);
      return;
    }

    // Filter bills within the new date range
    const relevantBills = deliveredBills.filter((bill) => {
      if (!bill.orderId?.createdAt) return false;
      const orderDate = new Date(bill.orderId.createdAt);
      return (
        orderDate >= new Date(start_date) && orderDate <= new Date(end_date)
      );
    });

    if (relevantBills.length === 0) {
      console.log(
        `No bills found within new date range for target "${target.name}" — achievement stays at 0`,
      );
      return;
    }

    console.log(`Processing ${relevantBills.length} relevant bills`);

    // ── Step 4: Calculate achievement from relevant bills ───────────────────
    let totalValue = 0;
    let totalVolume = 0;

    for (const bill of relevantBills) {
      for (const item of bill.lineItems || []) {
        if (
          item.itemBillType === "Item Removed" ||
          item.itemBillType === "Stock out"
        ) {
          continue;
        }

        try {
          const productId = item.product?._id || item.product;
          const product = await Product.findById(productId)
            .select("brand subBrand no_of_pieces_in_a_box")
            .lean();

          if (!product) {
            console.warn(
              `Product ${productId} not found in bill ${bill.billNo}`,
            );
            continue;
          }

          const productBrandId = product.brand?.toString();
          const productSubBrandId = product.subBrand?.toString();

          let itemCounts = false;

          // Type 1: No brand, no subBrand → count everything
          if (!hasBrands && !hasSubBrands) {
            itemCounts = true;
          }

          // Type 2: Brand + SubBrand defined on target
          // product brand must match — if product also has subBrand it must match too
          // products without subBrand assigned still count as long as brand matches
          if (hasBrands && hasSubBrands) {
            if (productBrandId && targetBrandIds.includes(productBrandId)) {
              if (
                !productSubBrandId ||
                targetSubBrandIds.includes(productSubBrandId)
              ) {
                itemCounts = true;
              }
            }
          }

          // Type 3: Brand only → brand must match
          if (hasBrands && !hasSubBrands) {
            itemCounts =
              !!productBrandId && targetBrandIds.includes(productBrandId);
          }

          if (!itemCounts) continue;

          totalValue += Number(item.netAmt || 0);

          const orderQty = Number(item.oderQty || 0);
          if (orderQty > 0) {
            if (item.uom === "pcs") {
              totalVolume += orderQty;
            } else if (item.uom === "box") {
              const piecesPerBox = Number(product.no_of_pieces_in_a_box || 0);
              if (piecesPerBox > 0) totalVolume += orderQty * piecesPerBox;
            }
          }
        } catch (itemError) {
          console.error(
            `Error processing item in bill ${bill.billNo}:`,
            itemError.message,
          );
        }
      }
    }

    const totalAchievement = target_type === "value" ? totalValue : totalVolume;

    console.log(
      `Recalculated ${target_type} achievement: ${totalAchievement}${
        target_type === "volume" ? " pcs" : " INR"
      }`,
    );

    // ── Step 5: Resolve correct slab based on new achievement ───────────────
    const matchedSlab = await resolveSlabForTarget(
      { ...target, achivedTarget: totalAchievement },
      totalAchievement,
    );

    // ── Step 6: Save recalculated achievement and slab ──────────────────────
    const updated = await SecondaryTarget.findByIdAndUpdate(
      _id,
      {
        achivedTarget: totalAchievement,
        currentTargetSlabId: matchedSlab ? matchedSlab._id : null,
      },
      { new: true },
    );

    if (updated) {
      console.log(
        `✅ Recalculated target "${updated.name}" after edit: ${totalAchievement}/${updated.target} (${target_type})${
          matchedSlab ? ` | Slab: ${matchedSlab.name}` : " | No slab"
        }`,
      );
    }
  } catch (error) {
    console.error(
      `Error in recalculateAfterTargetEdit for target ${targetId}:`,
      error.message,
    );
    // Don't throw — edit response should not fail because of recalculation
  }
};

module.exports = {
  updateSecondaryTargetAchievement,
  calculateHistoricalAchievement,
  recalculateAfterTargetEdit,
};
