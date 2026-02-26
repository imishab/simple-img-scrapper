const { getDb } = require("./db");

const COUNTER_ID = "voucher_inv";
const PREFIX = "CV-INV";
const START_VALUE = 1000; // first number is CV-INV-1000

function formatNumber(n) {
  return `${PREFIX}-${n}`;
}

/**
 * Preview next N numbers WITHOUT incrementing the counter. Safe to call on page load.
 */
async function getPreviewVoucherNumbers(count = 1) {
  const db = getDb();
  const col = db.collection("counters");
  const doc = await col.findOne({ _id: COUNTER_ID });
  const current = doc?.value ?? START_VALUE - 1;
  const numbers = [];
  for (let i = 1; i <= count; i++) {
    numbers.push(formatNumber(current + i));
  }
  return numbers;
}

/**
 * Commit (reserve) next N numbers, increment counter, and save them to the vouchers collection.
 * Call this only when user confirms print.
 */
async function commitVoucherNumbers(count = 1) {
  const db = getDb();
  const col = db.collection("counters");
  const vouchersCol = db.collection("vouchers");

  const result = await col.findOneAndUpdate(
    { _id: COUNTER_ID },
    [{ $set: { value: { $add: [{ $ifNull: ["$value", START_VALUE - 1] }, count] } } }],
    {
      upsert: true,
      returnDocument: "after",
    }
  );

  const lastNum = result.value;
  const firstNum = lastNum - count + 1;
  const numbers = [];
  const now = new Date();
  for (let n = firstNum; n <= lastNum; n++) {
    const voucherNumber = formatNumber(n);
    numbers.push(voucherNumber);
    vouchersCol.insertOne({ voucherNumber, createdAt: now });
  }
  return numbers;
}

module.exports = { getPreviewVoucherNumbers, commitVoucherNumbers };
