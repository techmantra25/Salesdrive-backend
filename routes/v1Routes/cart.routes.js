const express = require("express");
const createCart = require("../../controllers/cart/createCart");
const detailCart = require("../../controllers/cart/detailCart");
const removeProduct = require("../../controllers/cart/removeProduct");
const cartUpdate = require("../../controllers/cart/cartUpdate");
const retailerCartCount = require("../../controllers/cart/retailerCartCount");

const protectRetailerRoute = require("../../middlewares/ptotectReatilerRoute");

const CartRouter = express.Router();

CartRouter.post("/create-cart", protectRetailerRoute, createCart);

CartRouter.get("/detail", protectRetailerRoute, detailCart);

CartRouter.get("/count", protectRetailerRoute, retailerCartCount);

CartRouter.post("/remove-product", protectRetailerRoute, removeProduct);

CartRouter.patch("/update-product", protectRetailerRoute, cartUpdate);

module.exports = CartRouter;
