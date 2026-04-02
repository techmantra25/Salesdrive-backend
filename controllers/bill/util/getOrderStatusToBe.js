const getBillQty = (billList, productId) => {
  let billQty = 0;
  const notCanceledBillList = billList.filter(
    (bill) => bill.status !== "Cancelled"
  );

  for (const bill of notCanceledBillList) {
    if (bill?.lineItems) {
      for (const item of bill.lineItems) {
        if (String(item.product) === String(productId)) {
          billQty += item.billQty;
        }
      }
    }
  }
  return billQty;
};

const getOrderStatusToBe = (billList, LineItems) => {
  for (const lineItem of LineItems) {
    const orderQty = lineItem.oderQty;
    const billQty = getBillQty(billList, lineItem.product);
    if (orderQty > billQty) {
      return "Partially_Billed";
    }
  }

  return "Completed_Billed";
};

module.exports = getOrderStatusToBe;
