import { test } from "node:test";
import assert from "node:assert/strict";
import {
  convertedMinor,
  demoTransactions,
  isManagement,
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

test("management entries change only the balance, using their registration FX", () => {
  const sample = demoTransactions("2026-11")[0];
  const transactions = [
    { ...sample, id: "salary", amountMinor: 50000 },
    {
      ...sample,
      id: "food",
      type: "expense" as const,
      category: "food",
      amountMinor: 10000,
    },
    {
      ...sample,
      id: "opening",
      category: "management",
      amountMinor: 10000,
      currency: "USD",
      fx: { ...sample.fx, rates: { DKK: 1, USD: 0.2 } },
    },
    {
      ...sample,
      id: "adjustment",
      type: "expense" as const,
      category: "management",
      amountMinor: 5000,
    },
  ];
  assert.deepEqual(totals(transactions, "DKK"), {
    income: 50000,
    expense: 10000,
    balance: 85000,
    missing: 0,
  });
  const management = transactions.filter(isManagement);
  assert.deepEqual(totals(management, "DKK"), {
    income: 0,
    expense: 0,
    balance: 45000,
    missing: 0,
  });
  assert.deepEqual(totals(management, "EUR"), {
    income: 0,
    expense: 0,
    balance: -668,
    missing: 1,
  });
  assert.deepEqual(totals([], "DKK"), {
    income: 0,
    expense: 0,
    balance: 0,
    missing: 0,
  });
});

test("management is available by default and existing same-name custom entries normalize without data loss", () => {
  const sample = { ...demoTransactions("2026-11")[0], category: "management" };
  const ledger = { ...newLedger(), transactions: [sample] };
  assert.deepEqual(parseLedger(JSON.stringify(ledger)), ledger);
  const legacy = {
    ...ledger,
    customCategories: [
      { id: "custom-existing", label: "관리항목" },
      { id: "custom-travel", label: "여행" },
    ],
    transactions: [{ ...sample, category: "custom-existing" }],
  };
  const normalized = parseLedger(JSON.stringify(legacy));
  assert.deepEqual(normalized.transactions, [sample]);
  assert.deepEqual(normalized.customCategories, [
    { id: "custom-travel", label: "여행" },
  ]);
  assert.deepEqual(parseLedger(JSON.stringify(normalized)), normalized);
  assert.equal(legacy.transactions[0].category, "custom-existing");
  assert.throws(() =>
    parseLedger(
      JSON.stringify({
        ...legacy,
        customCategories: [
          ...legacy.customCategories,
          { id: "custom-duplicate", label: "관리항목" },
        ],
      }),
    ),
  );
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

test("custom categories persist while old ledgers remain readable", () => {
  const legacy: Partial<ReturnType<typeof newLedger>> = {
    ...newLedger(),
    transactions: demoTransactions("2026-11"),
  };
  delete legacy.customCategories;
  assert.deepEqual(parseLedger(JSON.stringify(legacy)).customCategories, []);
  const ledger = {
    ...newLedger(),
    customCategories: [{ id: "custom-travel", label: "여행" }],
    transactions: [
      { ...demoTransactions("2026-11")[1], category: "custom-travel" },
    ],
  };
  assert.deepEqual(parseLedger(JSON.stringify(ledger)), ledger);
  for (const customCategories of [
    null,
    {},
    [{ id: "food", label: "여행" }],
    [{ id: "custom-1", label: "식비" }],
    [{ id: "custom-1", label: "" }],
    [{ id: "custom-1", label: " 여행 " }],
    [{ id: "custom-1", label: "가".repeat(31) }],
    [
      { id: "custom-1", label: "여행" },
      { id: "custom-1", label: "건강" },
    ],
    [
      { id: "custom-1", label: "Travel" },
      { id: "custom-2", label: "ＴＲＡＶＥＬ" },
    ],
  ])
    assert.throws(() =>
      parseLedger(JSON.stringify({ ...newLedger(), customCategories })),
    );
  assert.throws(() =>
    parseLedger(JSON.stringify({ ...ledger, customCategories: [] })),
  );
  assert.throws(() =>
    parseLedger(
      JSON.stringify({
        ...ledger,
        transactions: [{ ...ledger.transactions[0], category: "constructor" }],
      }),
    ),
  );
});
