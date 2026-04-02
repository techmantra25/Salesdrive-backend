const getInTransitQty = (InvoiceList, productId) => {
  // Ensure productId is a string using toString()
  const productIdStr = productId && productId.toString();

  const inTransitQty = InvoiceList.filter(
    (invoice) => invoice.status === "In-Transit"
  ).reduce((total, invoice) => {
    // For each invoice, sum the receivedQty of matching productId in lineItems
    const qtyInInvoice = invoice.lineItems
      .filter(
        (item) =>
          item.product &&
          item.product._id &&
          item.product._id.toString() === productIdStr
      )
      .reduce((sum, item) => sum + (item.receivedQty ?? 0), 0);
    return total + qtyInInvoice;
  }, 0);

  return inTransitQty;
};

module.exports = getInTransitQty;
