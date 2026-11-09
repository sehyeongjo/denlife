import { test } from "node:test";
import assert from "node:assert/strict";
import { demoTransactions, type Transaction } from "../src/lib/ledger.ts";
import {
  cashflowTrend,
  categoryBreakdown,
  periodTransactions,
} from "../src/lib/ledger-analytics.ts";

const base = demoTransactions("2024-02")[1];
const expense = (
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  ...base,
  id,
  date: "2024-02-29",
  category: "food",
  amountMinor: 10000,
  fx: { ...base.fx, rates: { DKK: 1, USD: 0.2 } },
  ...overrides,
});

test("month and year views include only the requested period, newest first", () => {
  const transactions = [
    expense("leap-day"),
    expense("next-month", { date: "2024-03-01" }),
    expense("prior-year", { date: "2023-12-31" }),
    expense("new-year", { date: "2024-01-01" }),
  ];
  assert.deepEqual(
    periodTransactions(transactions, "2024-02", "month").map((item) => item.id),
    ["leap-day"],
  );
  assert.deepEqual(
    periodTransactions(transactions, "2024-02", "year").map((item) => item.id),
    ["next-month", "leap-day", "new-year"],
  );
  assert.equal(transactions[0].id, "leap-day");
});

test("category shares sum registration-rate amounts and separate income from expense", () => {
  const transactions = [
    expense("dkk"),
    expense("usd", { currency: "USD", amountMinor: 1000 }),
    expense("transport", { category: "transport", amountMinor: 5000 }),
    expense("income", {
      type: "income",
      category: "salary",
      amountMinor: 80000,
    }),
    expense("missing", { currency: "EUR" }),
  ];
  assert.deepEqual(categoryBreakdown(transactions, "DKK", "expense"), {
    total: 20000,
    missing: 1,
    items: [
      { category: "food", amount: 15000, percent: 75 },
      { category: "transport", amount: 5000, percent: 25 },
    ],
  });
  assert.equal(categoryBreakdown(transactions, "DKK", "income").total, 80000);
  const selected = transactions.filter((item) => item.category === "transport");
  assert.deepEqual(categoryBreakdown(selected, "DKK", "expense").items, [
    { category: "transport", amount: 5000, percent: 100 },
  ]);
  assert.equal(categoryBreakdown(transactions, "USD", "expense").total, 4000);
  assert.deepEqual(categoryBreakdown([], "DKK", "expense"), {
    total: 0,
    missing: 0,
    items: [],
  });
});

test("cashflow fills every day and month, handles leap years, missing rates and year boundaries", () => {
  const transactions = [
    expense("daily"),
    expense("income", { type: "income", amountMinor: 30000 }),
    expense("usd", { currency: "USD", amountMinor: 1000 }),
    expense("march", { date: "2024-03-01", amountMinor: 20000 }),
    expense("prior", { date: "2023-02-28" }),
    expense("missing", { currency: "EUR" }),
  ];
  const daily = cashflowTrend(transactions, "DKK", "2024-02", "month");
  assert.equal(daily.points.length, 29);
  assert.equal(daily.missing, 1);
  assert.deepEqual(daily.points[0], {
    key: "2024-02-01",
    label: "1일",
    income: 0,
    expense: 0,
  });
  assert.deepEqual(daily.points[28], {
    key: "2024-02-29",
    label: "29일",
    income: 30000,
    expense: 15000,
  });
  assert.equal(cashflowTrend([], "DKK", "2025-02", "month").points.length, 28);
  assert.equal(cashflowTrend([], "DKK", "2026-11", "month").points.length, 30);
  assert.equal(cashflowTrend([], "DKK", "2026-12", "month").points.length, 31);
  const yearly = cashflowTrend(transactions, "DKK", "2024-02", "year");
  assert.equal(yearly.points.length, 12);
  assert.equal(yearly.points[1].expense, 15000);
  assert.equal(yearly.points[1].income, 30000);
  assert.equal(yearly.points[2].expense, 20000);
  assert.equal(yearly.points[11].expense, 0);
  assert.equal(yearly.missing, 1);
});

test("management is excluded from both chart totals and percentages in month and year views", () => {
  const regular = [
    expense("food"),
    expense("income", {
      type: "income",
      category: "salary",
      amountMinor: 30000,
    }),
  ];
  const management = [
    expense("management-income", {
      category: "management",
      type: "income",
      amountMinor: 9999999,
    }),
    expense("management-expense", {
      category: "management",
      amountMinor: 80000,
    }),
    expense("management-missing", { category: "management", currency: "EUR" }),
  ];
  const all = [...regular, ...management];
  for (const type of ["income", "expense"] as const) {
    assert.deepEqual(
      categoryBreakdown(all, "DKK", type),
      categoryBreakdown(regular, "DKK", type),
    );
    assert.deepEqual(categoryBreakdown(management, "DKK", type), {
      total: 0,
      missing: 0,
      items: [],
    });
  }
  for (const mode of ["month", "year"] as const) {
    assert.deepEqual(
      cashflowTrend(all, "DKK", "2024-02", mode),
      cashflowTrend(regular, "DKK", "2024-02", mode),
    );
    const empty = cashflowTrend(management, "DKK", "2024-02", mode);
    assert.equal(empty.missing, 0);
    assert.ok(
      empty.points.every((point) => point.income === 0 && point.expense === 0),
    );
  }
});

test("outgoing and incoming transfers are excluded from both charts in every period", () => {
  const regular = [expense("food"), expense("salary", { type: "income" })];
  const transfers = [
    expense("transfer", {
      type: "transfer",
      category: "management",
      toAssetId: "asset-cash",
    }),
  ];
  for (const currency of ["DKK", "EUR"]) {
    for (const type of ["income", "expense"] as const)
      assert.deepEqual(
        categoryBreakdown([...regular, ...transfers], currency, type),
        categoryBreakdown(regular, currency, type),
      );
    for (const mode of ["month", "year"] as const)
      assert.deepEqual(
        cashflowTrend([...regular, ...transfers], currency, "2024-02", mode),
        cashflowTrend(regular, currency, "2024-02", mode),
      );
  }
});
