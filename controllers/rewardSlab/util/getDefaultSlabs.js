const defaultSlabs = [
  {
    slabType: "Volume Multiplier",
    description: "Rewards based on total reward point accrued this month.",
    slabs: [
      {
        slabName: "3000",
        description:
          "If the total reward point accrued this month is between 3000 and 6999",
        percentage: 10,
      },
      {
        slabName: "7000",
        description:
          "If the total reward point accrued this month is between 7000 and 10999",
        percentage: 20,
      },
      {
        slabName: "11000",
        description:
          "If the total reward point accrued this month is greater than or equal to 11000",
        percentage: 30,
      },
    ],
    status: "active",
  },
  {
    slabType: "Bill Volume Multiplier",
    description: "Rewards based on total amount billed this month.",
    slabs: [
      {
        slabName: "3000",
        description:
          "If the total amount billed this month is between 3000 and 6999",
        percentage: 10,
      },
      {
        slabName: "7000",
        description:
          "If the total amount billed this month is between 7000 and 10999",
        percentage: 20,
      },
      {
        slabName: "11000",
        description:
          "If the total amount billed this month is greater than or equal to 11000",
        percentage: 30,
      },
    ],
    status: "inactive",
  },
  {
    slabType: "Consistency Multiplier",
    description: "Rewards based on consistency over months",
    slabs: [
      {
        slabName: "1 Months",
        description: "If billed in this month",
        percentage: 10,
      },
      {
        slabName: "2 Months",
        description: "If billed 2 months in a row",
        percentage: 20,
      },
      {
        slabName: "3 Months",
        description: "If billed 3 months in a row",
        percentage: 30,
      },
    ],
    status: "active",
  },
];

const getDefaultSlabs = () => {
  return defaultSlabs;
};

module.exports = { getDefaultSlabs };
