const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    product_code: {
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
    subBrand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubBrand",
      required: false,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
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
    no_of_pieces_in_a_box: {
      type: String,
    },
    name: {
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
    product_type: {
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
      // "1PA",
      // "2PA",
      // "3PA",
      // "BOX",
      // "DZ",
      // "PAA",
      // "PAK"
      type: String, // PC -> pcs, BOX -> box, DZ -> dz
      enum: {
        values: ["pcs", "box", "dz", "1PA", "2PA", "3PA", "PAA", "PAK"],
        message: "values allowed pcs/box/dz/1PA/2PA/3PA/PAA/PAK",
        default: "pcs",
      },
    },
    base_point: {
      type: String,
      default: null,
    },
    ean11:{//new field to store the ean code
      type:String,
      default:null,
      trim:true,
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

productSchema.index({ cat_id: 1 });
productSchema.index({ collection_id: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ subBrand: 1 });

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
