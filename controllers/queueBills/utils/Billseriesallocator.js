/**
 * billSeriesAllocator.js
 *
 * Race-free bill series number allocation.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The naive pattern of  $inc currentNumber +N  then  $inc currentNumber -wasted
 * on failure is broken under concurrency:
 *
 *   1. Controller A pre-allocates BILL0015  →  currentNumber = 15
 *   2. Controller B pre-allocates BILL0016  →  currentNumber = 16
 *   3. Job A fails; worker rolls back:       $inc currentNumber -1  →  15
 *   4. Job B succeeds with BILL0016.         currentNumber is now 15.
 *   5. Controller C runs: $inc +1            →  16  →  BILL0016 DUPLICATE
 *      BILL0015 is permanently lost.
 *
 * SOLUTION — reclaim pool
 * ───────────────────────
 * Instead of decrementing the counter, we push the unused number into a
 * `reclaimPool` array on the series document.  The next allocation atomically
 * pops from the pool first; if the pool is empty it increments fresh.
 * The counter only ever goes forward — no decrement races, no gaps.
 *
 * SCHEMA ADDITION REQUIRED
 * ────────────────────────
 * Add to new_billSeries model:
 *
 *   reclaimPool: { type: [Number], default: [] }
 *
 * The field is sparse — documents created before this migration just get an
 * implicit empty array on the first findOneAndUpdate that touches it.
 */

const new_billSeries = require("../../../models/new_billseries.model");

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Format a raw integer using the series prefix and zero-padding.
 * @param {Object} series  - new_billSeries document (must have prefix, series_number)
 * @param {number} num     - integer to format
 * @returns {string}       - e.g. "BILL0015"
 */
const formatNumber = (series, num) => {
  const padded = String(num).padStart(series.series_number.length, "0");
  return `${series.prefix}${padded}`;
};

/**
 * Extract the raw integer from a formatted bill number string.
 * Returns NaN if parsing fails — callers must guard.
 * @param {Object} series  - new_billSeries document
 * @param {string} str     - e.g. "BILL0015"
 * @returns {number}
 */
const parseNumber = (series, str) => {
  if (!str || !series?.prefix) return NaN;
  return parseInt(str.slice(series.prefix.length), 10);
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Allocate a single bill series number.
 *
 * Drains the reclaimPool first (filling any gap from a previous failure),
 * then increments currentNumber when the pool is empty.
 * The operation is atomic — no two callers can receive the same number.
 *
 * @param {string|ObjectId} seriesId
 * @returns {Promise<string|null>}  formatted bill number, or null on failure
 */
const allocateBillSeriesNumber = async (seriesId) => {
  // ── Try reclaim pool first ──────────────────────────────────────────────
  // $pop with -1 removes the FIRST element (lowest index).
  // We need `new: false` so we can read the element that was removed.
  const docBefore = await new_billSeries.findOneAndUpdate(
    { _id: seriesId, "reclaimPool.0": { $exists: true } },
    { $pop: { reclaimPool: -1 } },
    { new: false },
  );

  if (docBefore && docBefore.reclaimPool.length > 0) {
    // reclaimPool[0] is the value that was just removed
    const reclaimedNum = docBefore.reclaimPool[0];
    console.log(
      `♻️  Reclaimed bill series number ${formatNumber(docBefore, reclaimedNum)} from pool`,
    );
    return formatNumber(docBefore, reclaimedNum);
  }

  // ── Fresh allocation ────────────────────────────────────────────────────
  const updated = await new_billSeries.findByIdAndUpdate(
    seriesId,
    { $inc: { currentNumber: 1 } },
    { new: true },
  );

  if (!updated) {
    console.error(`❌ allocateBillSeriesNumber: series ${seriesId} not found`);
    return null;
  }

  return formatNumber(updated, updated.currentNumber);
};

/**
 * Allocate `count` bill series numbers atomically.
 *
 * 1. Drain the entire reclaimPool in one atomic op.
 * 2. If the pool had more than `count` items, push the excess back.
 * 3. For remaining slots, do a single  $inc currentNumber +remaining.
 * 4. Returns exactly `count` formatted numbers, ascending order.
 *
 * @param {string|ObjectId} seriesId
 * @param {number}          count
 * @returns {Promise<string[]>}  array of exactly `count` formatted numbers
 */
const bulkAllocateBillSeriesNumbers = async (seriesId, count) => {
  if (count <= 0) return [];

  // ── Drain entire reclaim pool atomically ────────────────────────────────
  const docBefore = await new_billSeries.findOneAndUpdate(
    { _id: seriesId, "reclaimPool.0": { $exists: true } },
    { $set: { reclaimPool: [] } },
    { new: false },
  );

  const reclaimed = (docBefore?.reclaimPool || []).sort((a, b) => a - b);
  const reclaimedSlice = reclaimed.slice(0, count); // use up to `count`
  const leftover = reclaimed.slice(count); // excess → push back

  if (leftover.length > 0) {
    await new_billSeries.findByIdAndUpdate(seriesId, {
      $push: { reclaimPool: { $each: leftover } },
    });
  }

  const freshNeeded = count - reclaimedSlice.length;
  const freshNumbers = [];

  // ── Fresh allocation for remaining slots ────────────────────────────────
  if (freshNeeded > 0) {
    const updated = await new_billSeries.findByIdAndUpdate(
      seriesId,
      { $inc: { currentNumber: freshNeeded } },
      { new: true },
    );

    if (!updated) {
      throw new Error(
        `bulkAllocateBillSeriesNumbers: series ${seriesId} not found`,
      );
    }

    const start = updated.currentNumber - freshNeeded + 1;
    for (let i = 0; i < freshNeeded; i++) {
      freshNumbers.push(formatNumber(updated, start + i));
    }
  }

  // ── Merge: reclaimed (ascending) + fresh (ascending) ───────────────────
  // The series document is needed for formatNumber when only reclaimed.
  const seriesDoc = docBefore ?? (await new_billSeries.findById(seriesId));
  const reclaimedFormatted = reclaimedSlice.map((n) =>
    formatNumber(seriesDoc, n),
  );

  const result = [...reclaimedFormatted, ...freshNumbers];

  if (reclaimedSlice.length > 0) {
    console.log(
      `♻️  Bulk reused ${reclaimedSlice.length} reclaimed number(s): ${reclaimedFormatted.join(", ")}`,
    );
  }
  console.log(
    `✅ Bulk allocated ${count} bill number(s): ${result[0]} → ${result[result.length - 1]}`,
  );

  return result;
};

/**
 * Return a pre-allocated bill series number back to the pool.
 *
 * Call this when a bill creation fails AFTER a number was assigned so the
 * number can be reused by the next successful bill rather than forming a gap.
 *
 * Safe to call multiple times for the same number ($addToSet is idempotent).
 * Safe to call with null/undefined (no-op).
 *
 * @param {string|ObjectId} seriesId
 * @param {string}          billNumberStr  - e.g. "BILL0015"
 */
const reclaimBillSeriesNumber = async (seriesId, billNumberStr) => {
  if (!seriesId || !billNumberStr) return;

  try {
    const series = await new_billSeries.findById(seriesId);
    if (!series) {
      console.warn(
        `⚠️ reclaimBillSeriesNumber: series ${seriesId} not found — skipping reclaim of ${billNumberStr}`,
      );
      return;
    }

    const numeric = parseNumber(series, billNumberStr);
    if (isNaN(numeric)) {
      console.warn(
        `⚠️ reclaimBillSeriesNumber: could not parse numeric part from "${billNumberStr}" with prefix "${series.prefix}"`,
      );
      return;
    }

    await new_billSeries.findByIdAndUpdate(seriesId, {
      $addToSet: { reclaimPool: numeric }, // idempotent
    });

    console.log(
      `♻️  Reclaimed ${billNumberStr} (${numeric}) → reclaimPool on series ${seriesId}`,
    );
  } catch (err) {
    // Non-fatal — a missed reclaim leaves a gap, but never corrupts the counter
    console.error(
      `⚠️ reclaimBillSeriesNumber failed for ${billNumberStr}:`,
      err.message,
    );
  }
};

module.exports = {
  allocateBillSeriesNumber,
  bulkAllocateBillSeriesNumbers,
  reclaimBillSeriesNumber,
};
