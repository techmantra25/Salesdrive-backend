const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // ✅ RENAMED
    s4hana_code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    sku_group_id: {
      type: String,
      required: true,
    },
    sku_group__name: {
      type: String,
      required: true,
    },

    cat_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    collection_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collection",
      required: true,
    },

    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },

    // ✅ RENAMED (subBrand → segment)
    segment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubBrand",
      required: false,
    },

    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
    
    },

    size: {
      type: String,
    },
    color: {
      type: String,
    },
    pack: {
      type: String,
    },

    // ✅ RENAMED
    std_pkg_in_pc: {
      type: String,
    },

    // ✅ NEW FIELD
    wp_pc: {
      type: String,
    },

    // ✅ RENAMED (name → description)
    description: {
      type: String,
      required: true,
    },

    img_path: {
      type: String,
    },

    slug: {
      type: String,
      default: null,
    },

    // ✅ RENAMED
    collection_product_type: {
      type: String,
    },

    product_valuation_type: {
      type: String,
    },

    product_hsn_code: {
      type: String,
    },

    cgst: {
      type: String,
      default: null,
    },
    sgst: {
      type: String,
      default: null,
    },
    igst: {
      type: String,
      default: null,
    },

    sbu: {
      type: String,
      default: null,
    },

    uom: {
      type: String,
      enum: {
        values: ["pcs", "bndl", "box", "coil"],
        message: "values allowed pcs/bndl/box/coil",
      },
      default: "pcs",
    },

    base_point: {
      type: String,
      default: null,
    },

    ean11: {
      type: String,
      default: null,
      trim: true,
    },

    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ INDEXES (UPDATED)
productSchema.index({ cat_id: 1 });
productSchema.index({ collection_id: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ segment: 1 });

const Product = mongoose.model("Product", productSchema);

module.exports = Product;