const SecondaryTarget = require("../../../../models/secondaryTarget.model");
const Product = require("../../../../models/product.model");
const Bill = require("../../../../models/bill.model");
const{resolveSlabForTarget} = require("./resolveSlabForTarget");


const updateSecondaryTargetOnSalesReturn = async (salesReturn) => {
  try {
    // ── 1. Find the bill linked to this sales return ──────────────────────
    const bill = await Bill.findById(salesReturn.billId)
      .select("targetId distributorId retailerId")
      .lean();

    if (!bill) {
      console.log(`Bill not found for sales return ${salesReturn.salesReturnNo}`);
      return;
    }

    // ── 2. Find the secondary target linked to this bill ──────────────────
    if (!bill.targetId) {
      console.log(`No secondary target linked to bill for sales return ${salesReturn.salesReturnNo}`);
      return;
    }

    const target = await SecondaryTarget.findById(bill.targetId).lean();

    if (!target) {
      console.log(`Secondary target ${bill.targetId} not found for sales return ${salesReturn.salesReturnNo}`);
      return;
    }

    // ── 3. Determine target type — no brand, brand only, brand + subBrand ─
    const hasBrands    = target.brandId    && target.brandId.length    > 0;
    const hasSubBrands = target.subBrandId && target.subBrandId.length > 0;

    const targetBrandIds    = hasBrands
      ? target.brandId.map((id) => id.toString())
      : [];
    const targetSubBrandIds = hasSubBrands
      ? target.subBrandId.map((id) => id.toString())
      : [];

    console.log(
      `Processing sales return ${salesReturn.salesReturnNo} against target "${target.name}" | Type: ${
        !hasBrands && !hasSubBrands
          ? "No brand/subBrand (all items)"
          : hasBrands && hasSubBrands
          ? "Brand + SubBrand"
          : "Brand only"
      }`,
    );

    // ── 4. Calculate returned value/volume from line items ─────────────────
    let returnedValue  = 0;
    let returnedVolume = 0;

    for (const item of salesReturn.lineItems || []) {
      try {
        const productId = item.product?._id || item.product;
        const product   = await Product.findById(productId)
          .select("brand subBrand no_of_pieces_in_a_box")
          .lean();

        if (!product) {
          console.warn(
            `Product ${productId} not found in sales return ${salesReturn.salesReturnNo}`,
          );
          continue;
        }

        const productBrandId    = product.brand?.toString();
        const productSubBrandId = product.subBrand?.toString();

        // Determine if this line item counts for this target
        let itemCounts = false;

        // Type 1: No brand, no subBrand → count everything
        if (!hasBrands && !hasSubBrands) {
          itemCounts = true;
        }

        // Type 2: Brand + SubBrand → both must match
        if (hasBrands && hasSubBrands) {
          itemCounts =
            !!productBrandId &&
            !!productSubBrandId &&
            targetBrandIds.includes(productBrandId) &&
            targetSubBrandIds.includes(productSubBrandId);
        }

        // Type 3: Brand only → brand must match
        if (hasBrands && !hasSubBrands) {
          itemCounts =
            !!productBrandId && targetBrandIds.includes(productBrandId);
        }

        if (!itemCounts) continue;

        // Accumulate value
        returnedValue += Number(item.netAmt || 0);

        // Accumulate volume — returnQty converted to pieces
        const returnQty = Number(item.returnQty || 0);
        if (returnQty > 0) {
          if (item.uom === "pcs") {
            returnedVolume += returnQty;
          } else if (item.uom === "box") {
            const piecesPerBox = Number(product.no_of_pieces_in_a_box || 0);
            if (piecesPerBox > 0) {
              returnedVolume += returnQty * piecesPerBox;
            } else {
              console.warn(
                `Invalid no_of_pieces_in_a_box for product ${productId} in sales return ${salesReturn.salesReturnNo}`,
              );
            }
          }
        }
      } catch (itemError) {
        console.error(
          `Error processing line item in sales return ${salesReturn.salesReturnNo}:`,
          itemError.message,
        );
      }
    }

    // ── 5. Pick deduction amount based on target_type ─────────────────────
    const deductionAmount =
      target.target_type === "value" ? returnedValue : returnedVolume;

    if (deductionAmount <= 0) {
      console.log(
        `No relevant returned items found for target "${target.name}" in sales return ${salesReturn.salesReturnNo}`,
      );
      return;
    }

    // ── 6. Floor at 0 — achivedTarget should never go negative ───────────
    const newAchivedTarget = Math.max(
      0,
      (target.achivedTarget || 0) - deductionAmount,
    );

    // ── 7. Resolve the correct slab based on updated achievement ──────────
    const matchedSlab = await resolveSlabForTarget(
      { ...target, achivedTarget: newAchivedTarget },
      newAchivedTarget,
    );

    // ── 8. Update the target ──────────────────────────────────────────────
    const updated = await SecondaryTarget.findByIdAndUpdate(
      target._id,
      {
        $set: {
          achivedTarget:       newAchivedTarget,
          currentTargetSlabId: matchedSlab ? matchedSlab._id : null,
        },
        $inc: {
          returnedQty: deductionAmount,
        },
      },
      { new: true },
    );

    if (updated) {
      console.log(
        `✅ Target "${updated.name}" updated after sales return ${salesReturn.salesReturnNo}: -${deductionAmount} (${target.target_type}) → Achieved: ${updated.achivedTarget}/${updated.target} | Returned total: ${updated.returnedQty}${matchedSlab ? ` | Slab: ${matchedSlab.name}` : " | No slab"}`,
      );
    }
  } catch (error) {
    console.error(
      `Error in updateSecondaryTargetOnSalesReturn for sales return ${salesReturn.salesReturnNo}:`,
      error.message,
    );
    // Don't throw — we don't want target update failure to break the sales return creation
  }
};

module.exports = { updateSecondaryTargetOnSalesReturn }