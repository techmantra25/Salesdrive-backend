/**
 * Balance Calculator Utility
 * Ensures consistent balance calculations across the system
 * Handles credit (adds) and debit (subtracts) transaction types
 */

/**
 * Calculate new balance based on transaction type and points
 * @param {number} previousBalance - Starting balance
 * @param {string} transactionType - "credit" or "debit"
 * @param {number} points - Point amount
 * @returns {number} New balance
 */
const calculateNewBalance = (previousBalance, transactionType, points) => {
  const prev = Number(previousBalance) || 0;
  const pts = Number(points) || 0;

  if (transactionType === "credit") {
    return prev + pts;
  } else if (transactionType === "debit") {
    return prev - pts;
  }

  return prev;
};

/**
 * Calculate net points for a month considering transaction types
 * Sums credit transactions and subtracts debit transactions
 * @param {Array} transactions - Array of transactions with point and transactionType
 * @returns {number} Net points for the period
 */
const calculateNetPoints = (transactions) => {
  if (!Array.isArray(transactions)) return 0;

  return transactions.reduce((net, txn) => {
    const points = Number(txn.point) || 0;
    const txType = txn.transactionType || "credit";

    if (txType === "credit") {
      return net + points;
    } else if (txType === "debit") {
      return net - points;
    }
    return net;
  }, 0);
};

/**
 * Rebuild balance for a sequence of transactions
 * Creates proper running balance accounting for transaction types
 * @param {Array} transactions - Sorted array of transactions
 * @param {number} openingBalance - Starting balance (default 0)
 * @returns {Array} Transactions with corrected balance field
 */
const rebuildBalances = (transactions, openingBalance = 0) => {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return transactions;
  }

  let runningBalance = Number(openingBalance) || 0;

  return transactions.map((txn) => {
    const points = Number(txn.point) || 0;
    const txType = txn.transactionType || "credit";

    if (txType === "credit") {
      runningBalance += points;
    } else if (txType === "debit") {
      runningBalance -= points;
    }

    return {
      ...txn,
      balance: runningBalance,
    };
  });
};

/**
 * Group and aggregate transactions by retailer/distributor for monthly reconciliation
 * Properly calculates net points considering transaction types
 * @param {Array} transactions - Transactions to aggregate
 * @param {string} groupByField - Field to group by (e.g., "retailerId")
 * @returns {Map} Map with aggregated data per group
 */
const aggregateByTransactionType = (
  transactions,
  groupByField = "retailerId",
) => {
  const grouped = new Map();

  for (const txn of transactions) {
    const groupId = String(txn[groupByField] || "");
    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        credits: [],
        debits: [],
        netPoints: 0,
        totalCredits: 0,
        totalDebits: 0,
      });
    }

    const group = grouped.get(groupId);
    const points = Number(txn.point) || 0;
    const txType = txn.transactionType || "credit";

    if (txType === "credit") {
      group.credits.push(txn);
      group.totalCredits += points;
    } else if (txType === "debit") {
      group.debits.push(txn);
      group.totalDebits += points;
    }

    group.netPoints = group.totalCredits - group.totalDebits;
  }

  return grouped;
};

module.exports = {
  calculateNewBalance,
  calculateNetPoints,
  rebuildBalances,
  aggregateByTransactionType,
};
