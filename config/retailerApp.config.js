const { NODE_ENV } = require("./server.config");

// let RBP_POINT_BALANCE_CHECK_RETAILER = `https://rupa.quickdemo.in/api/store/balance`;
// let RBP_POINT_CREDIT_API = `http://rupa.quickdemo.in/api/earn/points`;
// let RBP_POINT_DEBIT_API = `http://rupa.quickdemo.in/api/debit/points`;
// let RBP_POINT_RETAILER_LEDGER_API = `https://rupa.quickdemo.in/api/retailer/ledger`;
// // let ALL_RETAILER_CURRENT_RBP_POINT_BALANCE = `https://ruparbp.mysalesdrive.in/api/retailer/balance`;

// let ALL_RETAILER_CURRENT_RBP_POINT_BALANCE = `https://rupa.quickdemo.in/api/retailer/balance`

let RBP_POINT_BALANCE_CHECK_RETAILER = ``;
let RBP_POINT_CREDIT_API = ``;
let RBP_POINT_DEBIT_API = ``;
let RBP_POINT_RETAILER_LEDGER_API = ``;
// let ALL_RETAILER_CURRENT_RBP_POINT_BALANCE = `https://ruparbp.mysalesdrive.in/api/retailer/balance`;

let ALL_RETAILER_CURRENT_RBP_POINT_BALANCE = ``

if (NODE_ENV === "production") {
  // RBP_POINT_BALANCE_CHECK_RETAILER = `https://ruparbp.mysalesdrive.in/api/store/balance`;
  // RBP_POINT_CREDIT_API = `https://ruparbp.mysalesdrive.in/api/earn/points`;
  // RBP_POINT_DEBIT_API = `https://ruparbp.mysalesdrive.in/api/debit/points`;
  // RBP_POINT_RETAILER_LEDGER_API = `https://ruparbp.mysalesdrive.in/api/retailer/ledger`;
  // ALL_RETAILER_CURRENT_RBP_POINT_BALANCE = `https://ruparbp.mysalesdrive.in/api/retailer/balance`;
}


module.exports = {
  RBP_POINT_BALANCE_CHECK_RETAILER,
  RBP_POINT_CREDIT_API,
  RBP_POINT_DEBIT_API,
  RBP_POINT_RETAILER_LEDGER_API,
  ALL_RETAILER_CURRENT_RBP_POINT_BALANCE,
};
