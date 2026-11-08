import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertedMinor,
  demoTransactions,
  newLedger,
  normalizeRates,
  parseAmount,
  parseLedger,
  shiftMonth,
  totals,
  validSnapshot,
} from "../src/lib/ledger.ts";

test("currency precision and amount validation", () => {
  assert.equal(parseAmount("12.34", "DKK"), 1234);
  assert.equal(parseAmount("42000", "KRW"), 42000);
  for (const value of ["0", "-1", "1e3", "1.234", "NaN", "Infinity", ""])
    assert.equal(parseAmount(value, "DKK"), null);
  assert.equal(parseAmount("12.5", "JPY"), null);
});

test("totals use each transaction's registration rate, independent of later rates", () => {
  const sample = demoTransactions("2026-11")[0];
  const first = {
    ...sample,
    id: "a",
    currency: "USD",
    amountMinor: 10000,
    fx: { ...sample.fx, rates: { DKK: 1, USD: 0.2, KRW: 200 } },
  };
  const second = {
    ...first,
    id: "b",
    fx: { ...first.fx, rates: { DKK: 1, USD: 0.25, KRW: 210 } },
  };
  assert.equal(convertedMinor(first, "DKK"), 50000);
  assert.equal(convertedMinor(first, "KRW"), 100000);
  assert.equal(convertedMinor(first, "USD"), 10000);
  assert.equal(totals([first, second], "DKK").income, 90000);
  assert.equal(totals([first, second], "EUR").missing, 2);
});

test("a newly enabled quote uses the existing full snapshot", () => {
  const sample = demoTransactions("2026-11")[0];
  assert.equal(convertedMinor({ ...sample, amountMinor: 10000 }, "SEK"), 14300);
});

test("storage roundtrip validates records and rejects invalid data without resetting it", () => {
  const ledger = {
    ...newLedger(),
    started: true,
    transactions: demoTransactions("2026-11"),
  };
  assert.deepEqual(parseLedger(JSON.stringify(ledger)), ledger);
  assert.throws(() => parseLedger("bad json"));
  assert.throws(() =>
    parseLedger(JSON.stringify({ ...ledger, currencies: ["BAD"] })),
  );
  assert.throws(() =>
    parseLedger(
      JSON.stringify({
        ...ledger,
        transactions: [{ ...ledger.transactions[0], amountMinor: -1 }],
      }),
    ),
  );
  assert.throws(() =>
    parseLedger(
      JSON.stringify({
        ...ledger,
        transactions: [{ ...ledger.transactions[0], date: "2026-02-31" }],
      }),
    ),
  );
});

test("rate response validation and month boundaries", () => {
  const rows = ["DKK", "KRW", "USD", "JPY", "EUR"].map((quote) => ({
    quote,
    base: "DKK",
    rate: quote === "DKK" ? 1 : 2,
    date: "2026-11-06",
  }));
  assert.equal(normalizeRates(rows).rates.USD, 2);
  assert.throws(() => normalizeRates([{ ...rows[0], rate: -1 }]));
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("older phone currency catalogues can read a snapshot with newly introduced quote codes", (context) => {
  const snapshot = demoTransactions("2026-11")[0].fx;
  context.mock.method(Intl, "supportedValuesOf", () => [
    "DKK",
    "KRW",
    "USD",
    "JPY",
    "EUR",
  ]);
  assert.equal(
    validSnapshot({
      ...snapshot,
      rates: { ...snapshot.rates, XCG: 0.3 },
      dates: { ...snapshot.dates, XCG: "2026-11-01" },
    }),
    true,
  );
});
