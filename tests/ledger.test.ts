import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetTransactions,
  convertedMinor,
  demoTransactions,
  isManagement,
  insertDecimalPoint,
  newLedger,
  normalizeRates,
  normalizeDecimalInput,
  parseAmount,
  parseLedger,
  shiftMonth,
  totals,
  validSnapshot,
  type Transaction,
} from "../src/lib/ledger.ts";

test("a transfer moves both asset balances without changing income, expenses, or the combined balance", () => {
  const base = demoTransactions("2026-11")[0];
  const opening = {
    ...base,
    id: "opening",
    category: "management",
    amountMinor: 20000,
  };
  const transfer: Transaction = {
    ...base,
    id: "transfer",
    type: "transfer",
    assetId: "default",
    toAssetId: "asset-cash",
    category: "management",
    currency: "USD",
    amountMinor: 1000,
    fx: { ...base.fx, rates: { DKK: 1, USD: 0.2 } },
  };
  const transactions = [opening, transfer];
  assert.equal(isManagement(transfer), false);
  assert.deepEqual(assetTransactions(transactions, "asset-cash"), [transfer]);
  assert.deepEqual(totals(transactions, "DKK"), totals([opening], "DKK"));
  for (const [currency, amount] of [
    ["DKK", 5000],
    ["USD", 1000],
  ] as const) {
    assert.deepEqual(totals([transfer], currency, "default"), {
      income: 0,
      expense: 0,
      balance: -amount,
      missing: 0,
    });
    assert.deepEqual(totals([transfer], currency, "asset-cash"), {
      income: 0,
      expense: 0,
      balance: amount,
      missing: 0,
    });
    assert.equal(totals([transfer], currency, "asset-other").balance, 0);
  }
  assert.equal(totals(transactions, "DKK", "default").balance, 15000);
  assert.equal(totals(transactions, "DKK", "asset-cash").balance, 5000);
  const edited = { ...transfer, amountMinor: 2000 };
  assert.equal(totals([opening, edited], "DKK", "default").balance, 10000);
  assert.equal(totals([opening, edited], "DKK", "asset-cash").balance, 10000);
  assert.equal(totals([opening], "DKK", "default").balance, 20000);
  assert.equal(totals([opening], "DKK", "asset-cash").balance, 0);
  assert.deepEqual(totals([transfer], "EUR"), {
    income: 0,
    expense: 0,
    balance: 0,
    missing: 0,
  });
  assert.equal(totals([transfer], "EUR", "asset-cash").missing, 1);
});

test("transfers validate both endpoints and cannot leave an orphaned asset reference", () => {
  const transfer: Transaction = {
    ...demoTransactions("2026-11")[0],
    type: "transfer",
    category: "management",
    toAssetId: "asset-cash",
  };
  const ledger = {
    ...newLedger(),
    assets: [...newLedger().assets, { id: "asset-cash", label: "현금" }],
    transactions: [transfer],
  };
  assert.deepEqual(parseLedger(JSON.stringify(ledger)), ledger);
  for (const toAssetId of [
    undefined,
    null,
    "default",
    "asset-missing",
    ["asset-cash"],
  ])
    assert.throws(() =>
      parseLedger(
        JSON.stringify({
          ...ledger,
          transactions: [{ ...transfer, toAssetId }],
        }),
      ),
    );
  for (const category of ["salary", "food"])
    assert.throws(() =>
      parseLedger(
        JSON.stringify({
          ...ledger,
          transactions: [{ ...transfer, category }],
        }),
      ),
    );
  for (const type of ["income", "expense"])
    assert.throws(() =>
      parseLedger(
        JSON.stringify({
          ...ledger,
          transactions: [{ ...transfer, type }],
        }),
      ),
    );
  assert.throws(() =>
    parseLedger(JSON.stringify({ ...ledger, assets: newLedger().assets })),
  );
  assert.throws(() =>
    parseLedger(JSON.stringify({ ...ledger, assets: [ledger.assets[1]] })),
  );
  assert.throws(() =>
    parseLedger(JSON.stringify({ ...ledger, assets: undefined })),
  );
});

test("legacy ledgers assign existing transactions to the default asset without changing money or snapshots", () => {
  const ledger = { ...newLedger(), transactions: demoTransactions("2026-11") };
  const { assets, ...legacy } = ledger;
  const raw = JSON.stringify({
    ...legacy,
    transactions: legacy.transactions.map(
      ({ assetId, ...transaction }) => transaction,
    ),
  });
  const normalized = parseLedger(raw);
  assert.deepEqual(normalized, ledger);
  assert.deepEqual(parseLedger(JSON.stringify(normalized)), ledger);
  assert.equal(JSON.parse(raw).transactions[0].assetId, undefined);
});

test("assets reject duplicate names, invalid IDs, and orphaned transactions", () => {
  const ledger = {
    ...newLedger(),
    assets: [...newLedger().assets, { id: "asset-cash", label: "현금" }],
    transactions: [
      { ...demoTransactions("2026-11")[0], assetId: "asset-cash" },
    ],
  };
  assert.deepEqual(parseLedger(JSON.stringify(ledger)), ledger);
  for (const assets of [
    [],
    null,
    [{ id: "invalid", label: "현금" }],
    [...ledger.assets, { id: "asset-duplicate", label: "현금" }],
    [...ledger.assets, { id: "asset-cash", label: "저축" }],
    [{ id: "asset-cash", label: " 현금 " }],
    [{ id: "asset-cash", label: " " }],
    [{ id: "asset-cash", label: "a".repeat(31) }],
    [
      { id: "asset-bank", label: "Bank" },
      { id: "asset-other", label: "ＢＡＮＫ" },
    ],
  ])
    assert.throws(() => parseLedger(JSON.stringify({ ...ledger, assets })));
  for (const assetId of [undefined, null, ["default"], "asset-missing"])
    assert.throws(() =>
      parseLedger(
        JSON.stringify({
          ...ledger,
          transactions: [{ ...ledger.transactions[0], assetId }],
        }),
      ),
    );
  assert.throws(() =>
    parseLedger(JSON.stringify({ ...ledger, assets: newLedger().assets })),
  );
  assert.doesNotThrow(() =>
    parseLedger(JSON.stringify({ ...ledger, assets: [ledger.assets[1]] })),
  );
});

test("asset filters separate balances, management entries, and currency conversion while preserving the total", () => {
  const sample = demoTransactions("2026-11")[0];
  const transactions = [
    { ...sample, id: "opening", category: "management", amountMinor: 50000 },
    { ...sample, id: "salary", amountMinor: 30000 },
    { ...sample, id: "food", type: "expense" as const, amountMinor: 10000 },
    {
      ...sample,
      id: "cash",
      assetId: "asset-cash",
      currency: "USD",
      amountMinor: 1000,
      fx: { ...sample.fx, rates: { DKK: 1, USD: 0.2 } },
    },
  ];
  assert.deepEqual(totals(assetTransactions(transactions, "default"), "DKK"), {
    income: 30000,
    expense: 10000,
    balance: 70000,
    missing: 0,
  });
  assert.deepEqual(
    totals(assetTransactions(transactions, "asset-cash"), "DKK"),
    {
      income: 5000,
      expense: 0,
      balance: 5000,
      missing: 0,
    },
  );
  assert.equal(
    totals(assetTransactions(transactions, ""), "DKK").balance,
    75000,
  );
  assert.deepEqual(assetTransactions(transactions, "asset-missing"), []);
  const moved = transactions.map((item) => ({
    ...item,
    assetId: "asset-cash",
  }));
  assert.equal(totals(moved, "DKK").balance, 75000);
  assert.equal(totals(assetTransactions(moved, "default"), "DKK").balance, 0);
});

test("currency precision and amount validation", () => {
  assert.equal(parseAmount("12.34", "DKK"), 1234);
  assert.equal(parseAmount("42000", "KRW"), 42000);
  for (const value of ["0", "-1", "1e3", "1.234", "NaN", "Infinity", ""])
    assert.equal(parseAmount(value, "DKK"), null);
  assert.equal(parseAmount("12.5", "JPY"), null);
});

test("decimal and comma keypads parse the same amount without treating grouping separators as money", () => {
  for (const currency of ["DKK", "EUR", "USD"]) {
    for (const value of ["12.34", "12,34", " 12,34 "])
      assert.equal(parseAmount(value, currency), 1234);
    for (const value of [".5", ",5", "0.5", "0,5"])
      assert.equal(parseAmount(value, currency), 50);
    assert.equal(parseAmount("12.", currency), 1200);
    assert.equal(parseAmount("12,", currency), 1200);
    for (const value of [
      "1,234",
      "12,345",
      "1.234,56",
      "1,234.56",
      "1 234,56",
      "12..34",
      "12,,34",
      ".",
      ",",
      "0,00",
      "-1,20",
      "1e3",
    ])
      assert.equal(parseAmount(value, currency), null, `${currency}: ${value}`);
  }
  for (const currency of ["KRW", "JPY"]) {
    assert.equal(parseAmount("1200", currency), 1200);
    for (const value of ["12,5", "12.5", "12,00", "1,200", "12."])
      assert.equal(parseAmount(value, currency), null);
  }
  assert.equal(normalizeDecimalInput(",5"), "0.5");
  assert.equal(normalizeDecimalInput("12,34"), "12.34");
});

test("on-screen decimal insertion respects the caret and selection without duplicate separators", () => {
  assert.deepEqual(insertDecimalPoint(""), { value: "0.", caret: 2 });
  assert.deepEqual(insertDecimalPoint("123"), { value: "123.", caret: 4 });
  assert.deepEqual(insertDecimalPoint("1234", 2), { value: "12.34", caret: 3 });
  assert.deepEqual(insertDecimalPoint("50", 0), { value: "0.50", caret: 2 });
  assert.deepEqual(insertDecimalPoint("12.34", 2, 3), {
    value: "12.34",
    caret: 3,
  });
  assert.deepEqual(insertDecimalPoint("12.34"), { value: "12.34", caret: 5 });
  assert.deepEqual(insertDecimalPoint("12,34"), { value: "12,34", caret: 5 });
  assert.deepEqual(insertDecimalPoint("1234", 0, 4), { value: "0.", caret: 2 });
  assert.equal(parseAmount(`${insertDecimalPoint("12").value}34`, "DKK"), 1234);
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
