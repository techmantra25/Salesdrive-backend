function escapeCSVValue(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  if (str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str}"`;
  }
  return str;
}

module.exports = escapeCSVValue;
