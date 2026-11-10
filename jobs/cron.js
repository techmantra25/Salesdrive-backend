const axios = require("axios");
const { API_URL } = require("../config/server.config");
const { registerCronJob, writeLog } = require("../utils/cronlogger");

// Sync inventory with product master daily at 5:00 AM and 12:00 PM
const syncInventoryWithProductMasterJob = registerCronJob({
  name: "SYNC_INVENTORY_WITH_PRODUCT_MASTER",
  functionName: "syncInventoryWithProductMasterJob", 
  schedule: "00 05,12 * * *",
  handler: async () => {
    const distributorId = "6a33c65753a484258e9b0979";

    const res = await axios.get(
      `${API_URL}/api/v1/inventory/sync-inventory-with-product-master?distributorId=${distributorId}`
    );

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Unexpected status ${res.status}`);
    }
  },
});

// Correct inventory intransitQty at 8:00 AM, 12:00 PM, 4:00 PM, 6:00 PM
const correctInventoryIntransitQtyJob = registerCronJob({
  name: "CORRECT_INTRANSIT_QTY",
  functionName: "correctInventoryIntransitQtyJob", 
  schedule: "0 8,12,16,18 * * *",
  handler: async () => {
    const res = await axios.post(
      `${API_URL}/api/v1/purchase-order/correct-intransit-qty`
    );

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Unexpected status ${res.status}`);
    }
  },
});

writeLog("🚀 Cron module loaded");

module.exports = {
  syncInventoryWithProductMasterJob,
  correctInventoryIntransitQtyJob,
};