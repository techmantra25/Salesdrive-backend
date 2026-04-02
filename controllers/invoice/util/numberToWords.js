// Convert number to words
function numberToWords(num) {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  if (num === 0) return "Zero";

  function convertLessThanOneThousand(num) {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    const ten = Math.floor(num / 10);
    const unit = num % 10;
    return tens[ten] + (unit ? " " + ones[unit] : "");
  }

  let result = "";
  let num1 = num;

  // Handle crores (10 million)
  if (num1 >= 10000000) {
    result +=
      convertLessThanOneThousand(Math.floor(num1 / 10000000)) + " Crore ";
    num1 %= 10000000;
  }

  // Handle lakhs (100 thousand)
  if (num1 >= 100000) {
    result += convertLessThanOneThousand(Math.floor(num1 / 100000)) + " Lakh ";
    num1 %= 100000;
  }

  // Handle thousands
  if (num1 >= 1000) {
    result +=
      convertLessThanOneThousand(Math.floor(num1 / 1000)) + " Thousand ";
    num1 %= 1000;
  }

  // Handle hundreds
  if (num1 >= 100) {
    result += convertLessThanOneThousand(Math.floor(num1 / 100)) + " Hundred ";
    num1 %= 100;
  }

  // Handle tens and ones
  if (num1 > 0) {
    result += convertLessThanOneThousand(num1);
  }

  return result.trim();
}

module.exports = numberToWords;
