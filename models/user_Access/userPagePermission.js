const mongoose = require("mongoose");

const pagePermissionSchema = new mongoose.Schema(
  {
    page: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PageMaster",
      required: true,
    },

       pageName: {
      type: String,
      required: true,
      trim: true,
    },
    pageSlug: {
      type: String,
      required: true,
      trim: true,
    },
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    update: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { _id: false }
);

const modulePermissionSchema = new mongoose.Schema(
  {
    module: {
      type: String,
      required: true,
      trim: true,
    },
    pages: [pagePermissionSchema],
  },
  { _id: false }
);

const userPermissionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    role: {
      type: String,
      required: true,
      trim: true,
    },

    modules: [modulePermissionSchema],
  },
  { timestamps: true }
);


module.exports = mongoose.model("UserPermission", userPermissionSchema);
