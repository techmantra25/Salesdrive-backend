const mongoose = require("mongoose");

const lockSchema = new mongoose.Schema(
  {
    name: { type: String, unique: true },
    createdAt: { type: Date, default: Date.now, expires: 600 },
  },
  { timestamps: true }
);

const Lock = mongoose.model("Lock", lockSchema);

async function acquireLock(lockName) {
  const result = await Lock.findOneAndUpdate(
    { name: lockName },
    { $setOnInsert: { name: lockName, createdAt: new Date() } },
    { upsert: true, new: false }
  );
  return result === null;
}

async function releaseLock(lockName) {
  await Lock.deleteOne({ name: lockName });
}

module.exports = {
  Lock,
  acquireLock,
  releaseLock,
}; 
