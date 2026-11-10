import { test } from "node:test";
import assert from "node:assert/strict";
import { demoTransactions, totals, type Transaction } from "../src/lib/ledger.ts";
import {
  cashflowTrend,
  categoryBreakdown,
  livingBudget,
  periodTransactions,
  reportingTransactions,
  withInitialSalary,
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

const salary = (
  date: string,
  amountMinor = 2_000_000,
  overrides: Partial<Transaction> = {},
) => expense(`salary-${date}`, {
  type: "income",
  category: "salary",
  date,
  amountMinor,
  ...overrides,
});

test("startup spending appears as other in November reports without adding saved transactions or deducting twice", () => {
  const transactions = [
    expense("food", { date: "2026-11-08", amountMinor: 10_000 }),
    expense("other", { date: "2026-11-09", category: "other", amountMinor: 20_000 }),
    expense("december", { date: "2026-12-01", amountMinor: 1_000 }),
  ];
  const original = structuredClone(transactions);
  const reporting = reportingTransactions(transactions);
  const november = periodTransactions(reporting, "2026-11", "month");
  assert.equal(totals(november, "DKK").expense, 815_842);
  const breakdown = categoryBreakdown(november, "DKK", "expense");
  assert.equal(breakdown.total, 815_842);
  assert.equal(breakdown.items.find(item => item.category === "other")?.amount, 805_842);
  assert.equal(categoryBreakdown(november.filter(item => item.category === "other"), "DKK", "expense").total, 805_842);
  assert.equal(cashflowTrend(november, "DKK", "2026-11", "month").points[0].expense, 785_842);
  assert.equal(totals(november, "USD").expense, 163_168);
  assert.equal(totals(periodTransactions(reporting, "2026-10", "month"), "DKK").expense, 0);
  assert.equal(totals(periodTransactions(reporting, "2026-12", "month"), "DKK").expense, 1_000);
  assert.equal(totals(periodTransactions(reporting, "2027-11", "month"), "DKK").expense, 0);
  assert.equal(totals(periodTransactions(reporting, "2026-11", "year"), "DKK").expense, 816_842);
  assert.deepEqual(reportingTransactions(reporting), reporting);
  assert.equal(periodTransactions(transactions, "2026-11", "month").length, 2);
  assert.equal(totals(transactions, "DKK").balance, -31_000);
  assert.deepEqual(transactions, original);
  const budget = livingBudget(transactions, "DKK", "2026-11-30", "", "2026-11")!;
  assert.equal(budget.expense, 30_000);
  assert.equal(budget.priorSpending, 785_842);
  assert.equal(budget.remaining, 1_099_196);
  assert.deepEqual(livingBudget(reporting, "DKK", "2026-11-30", "", "2026-11"), budget);
  assert.deepEqual(reportingTransactions(transactions, "asset-savings"), transactions);
  const withActualSalary = reportingTransactions([salary("2026-10-30")]);
  assert.equal(totals(periodTransactions(withActualSalary, "2026-11", "month"), "DKK").expense, 785_842);
});

test("the pre-recorded living expense applies once in November 2026 and only to the main budget", () => {
  const transactions = [
    salary("2026-10-01"),
    salary("2026-11-01"),
    expense("november", { date: "2026-11-09" }),
    salary("2026-12-01"),
    salary("2027-11-01"),
  ];
  const original = structuredClone(transactions);
  const october = livingBudget(transactions, "DKK", "2026-10-31", "", "2026-10")!;
  assert.equal(october.priorSpending, 0);
  assert.equal(october.remaining, 1_500_000);
  const november = livingBudget(transactions, "DKK", "2026-11-30", "", "2026-11")!;
  assert.equal(november.priorSpending, 785_842);
  assert.equal(november.expense, 10_000);
  assert.equal(november.remaining, 704_158);
  for (const month of ["2026-12", "2027-11"]) {
    const result = livingBudget(transactions, "DKK", `${month}-30`, "", month)!;
    assert.equal(result.priorSpending, 0);
    assert.equal(result.previousDeficit, 0);
    assert.equal(result.remaining, 1_500_000);
  }
  const otherAsset = livingBudget(
    transactions.map((item) => ({ ...item, assetId: "asset-savings" })),
    "DKK", "2026-11-30", "asset-savings", "2026-11",
  )!;
  assert.equal(otherAsset.priorSpending, 0);
  assert.equal(otherAsset.remaining, 1_490_000);
  assert.equal(totals(transactions, "DKK").expense, 10_000);
  assert.deepEqual(transactions, original);
});

test("switching months changes income and living budget while preserving the overall balance", () => {
  const transactions = [
    expense("november", { date: "2026-11-08", amountMinor: 2_100_000 }),
    salary("2026-12-01", 2_600_000),
    expense("december", { date: "2026-12-02", amountMinor: 100_000 }),
    expense("bonus", { date: "2026-12-02", type: "income", amountMinor: 20_000 }),
  ];
  const original = structuredClone(transactions);
  const reporting = reportingTransactions(transactions);
  assert.equal(totals(periodTransactions(reporting, "2026-10", "month"), "DKK").income, 0);
  assert.equal(totals(periodTransactions(reporting, "2026-11", "month"), "DKK").income, 2_415_038);
  assert.equal(totals(periodTransactions(reporting, "2026-12", "month"), "DKK").income, 2_620_000);
  const november = livingBudget(transactions, "DKK", "2026-11-30", "", "2026-11")!;
  const december = livingBudget(transactions, "DKK", "2026-12-31", "", "2026-12")!;
  assert.equal(november.remaining, -970_804);
  assert.equal(december.priorSpending, 0);
  assert.equal(december.previousDeficit, 970_804);
  assert.equal(december.remaining, 1_029_196);
  assert.equal(livingBudget(transactions, "DKK", "2027-01-31", "", "2027-01"), null);
  assert.equal(totals(periodTransactions(reporting, "2027-01", "month"), "DKK").income, 0);
  assert.equal(totals(transactions, "DKK").balance, 420_000);
  assert.deepEqual(transactions, original);
});

test("the initial income is counted once and an empty month or year never reuses its budget", () => {
  const transactions = [expense("november", { date: "2026-11-08", amountMinor: 100_038 })];
  const reporting = reportingTransactions(transactions);
  assert.deepEqual(withInitialSalary(reporting), reporting);
  assert.equal(livingBudget(transactions, "DKK", "2026-11-30", "", "2026-11")!.remaining, 1_029_158);
  assert.equal(livingBudget(transactions, "DKK", "2026-12-31", "", "2026-12"), null);
  assert.equal(totals(periodTransactions(reporting, "2026-12", "month"), "DKK").income, 0);
  assert.equal(livingBudget(transactions, "DKK", "2026-12-31", "", "2026")!.remaining, 1_029_158);
  assert.equal(livingBudget(transactions, "DKK", "2027-12-31", "", "2027"), null);
  assert.equal(totals(periodTransactions(reporting, "2026-11", "year"), "DKK").income, 2_415_038);
  assert.equal(totals(periodTransactions(reporting, "2027-11", "year"), "DKK").income, 0);
  assert.equal(categoryBreakdown(periodTransactions(reporting, "2026-11", "month"), "DKK", "income").total, 2_415_038);
  assert.equal(cashflowTrend(reporting, "DKK", "2026-11", "month").points[0].income, 2_415_038);
  assert.equal(withInitialSalary([], "asset-savings").length, 0);
  assert.equal(withInitialSalary([salary("2026-10-30")]).length, 1);
});

test("the October 2026 salary funds November living expenses without adding a transaction", () => {
  const initial = livingBudget([], "DKK", "2026-11-01")!;
  assert.equal(initial.start, "2026-11-01");
  assert.equal(initial.salary, 2_415_038);
  assert.equal(initial.savings, 500_000);
  assert.equal(initial.previousDeficit, 0);
  assert.equal(initial.priorSpending, 785_842);
  assert.equal(initial.remaining, 1_129_196);
  assert.equal(livingBudget([], "DKK", "2026-10-31"), null);

  const transactions = [expense("november", { date: "2026-11-08", amountMinor: 100_038 })];
  const original = structuredClone(transactions);
  assert.equal(livingBudget(transactions, "DKK", "2026-11-10")!.remaining, 1_029_158);
  assert.deepEqual(transactions, original);
  assert.equal(livingBudget(transactions, "DKK", "2026-11-10", "default")!.remaining, 1_029_158);
  assert.equal(livingBudget([], "DKK", "2026-11-10", "asset-savings"), null);

  const usd = livingBudget(transactions, "USD", "2026-11-10")!;
  assert.equal(usd.salary, 483_008);
  assert.equal(usd.savings, 100_000);
  assert.equal(usd.priorSpending, 157_168);
  assert.equal(usd.remaining, 205_832);
  assert.equal(livingBudget(transactions, "EUR", "2026-11-10")!.remaining, null);
});

test("a recorded October salary replaces the initial amount and November salary starts a new period", () => {
  const novemberExpense = expense("november", { date: "2026-11-08", amountMinor: 2_100_000 });
  const actualOctober = livingBudget([
    salary("2026-10-30", 2_500_000),
    novemberExpense,
  ], "DKK", "2026-11-10")!;
  assert.equal(actualOctober.start, "2026-10-30");
  assert.equal(actualOctober.salary, 2_500_000);
  assert.equal(actualOctober.remaining, -885_842);

  const transactions = [novemberExpense, salary("2026-11-27", 2_500_000)];
  const beforePayday = livingBudget(transactions, "DKK", "2026-11-26")!;
  assert.equal(beforePayday.salary, 2_415_038);
  assert.equal(beforePayday.remaining, -970_804);
  assert.equal(beforePayday.nextPayday, "2026-11-27");
  const afterPayday = livingBudget(transactions, "DKK", "2026-11-27")!;
  assert.equal(afterPayday.start, "2026-11-27");
  assert.equal(afterPayday.salary, 2_500_000);
  assert.equal(afterPayday.priorSpending, 0);
  assert.equal(afterPayday.previousDeficit, 970_804);
  assert.equal(afterPayday.expense, 0);
  assert.equal(afterPayday.remaining, 1_029_196);
});

test("living expenses run from payday and deduct savings and only the prior deficit", () => {
  const transactions = [
    salary("2023-12-25"),
    expense("december", { date: "2024-01-24", amountMinor: 1_000_000 }),
    salary("2024-01-25"),
    expense("january", { date: "2024-02-24", amountMinor: 1_700_000 }),
    salary("2024-02-25"),
    expense("february", { date: "2024-03-01", amountMinor: 300_000 }),
  ];
  const december = livingBudget(transactions, "DKK", "2024-01-24")!;
  assert.equal(december.remaining, 500_000);
  assert.equal(december.nextPayday, "2024-01-25");
  const january = livingBudget(transactions, "DKK", "2024-02-24")!;
  assert.equal(january.previousDeficit, 0);
  assert.equal(january.remaining, -200_000);
  assert.deepEqual(livingBudget(transactions, "DKK", "2024-03-01"), {
    start: "2024-02-25",
    salary: 2_000_000,
    savings: 500_000,
    previousDeficit: 200_000,
    priorSpending: 0,
    expense: 300_000,
    budget: 1_300_000,
    remaining: 1_000_000,
    nextPayday: undefined,
  });
});

test("unpaid deficits carry forward until repaid and a later surplus is discarded", () => {
  const transactions = [
    salary("2024-01-25", 600_000),
    expense("overspend", { date: "2024-01-26", amountMinor: 400_000 }),
    salary("2024-02-25", 600_000),
    salary("2024-03-25", 1_000_000),
    salary("2024-04-25", 1_000_000),
  ];
  const february = livingBudget(transactions, "DKK", "2024-02-29")!;
  assert.equal(february.previousDeficit, 300_000);
  assert.equal(february.remaining, -200_000);
  const march = livingBudget(transactions, "DKK", "2024-03-31")!;
  assert.equal(march.previousDeficit, 200_000);
  assert.equal(march.remaining, 300_000);
  const april = livingBudget(transactions, "DKK", "2024-04-30")!;
  assert.equal(april.previousDeficit, 0);
  assert.equal(april.remaining, 500_000);
});

test("payday expenses belong to the new period and same-day salaries reserve savings once", () => {
  const transactions = [
    expense("payday-expense", { date: "2024-02-29", amountMinor: 100_000 }),
    salary("2024-02-29", 1_000_000),
    salary("2024-01-31"),
    salary("2024-02-29", 1_000_000, { id: "second-salary" }),
    expense("prior-day", { date: "2024-02-28", amountMinor: 1_800_000 }),
    salary("2024-03-28"),
    expense("future", { date: "2024-03-01", amountMinor: 700_000 }),
  ];
  const originalIds = transactions.map((item) => item.id);
  const result = livingBudget(transactions, "DKK", "2024-02-29")!;
  assert.equal(result.start, "2024-02-29");
  assert.equal(result.salary, 2_000_000);
  assert.equal(result.savings, 500_000);
  assert.equal(result.previousDeficit, 300_000);
  assert.equal(result.expense, 100_000);
  assert.equal(result.remaining, 1_100_000);
  assert.equal(result.nextPayday, "2024-03-28");
  assert.deepEqual(transactions.map((item) => item.id), originalIds);
  assert.equal(
    livingBudget([...transactions].reverse(), "DKK", "2024-02-29")!.remaining,
    result.remaining,
  );
});

test("living budgets exclude other income, management, transfers and pre-payday expenses", () => {
  const regular = [
    salary("2024-02-25"),
    expense("food", { date: "2024-02-26" }),
  ];
  const ignored = [
    expense("before-salary", { date: "2024-02-24" }),
    expense("other-income", { date: "2024-02-26", type: "income" }),
    expense("management-income", {
      date: "2024-02-26", type: "income", category: "management",
    }),
    expense("management-expense", { date: "2024-02-26", category: "management" }),
    expense("transfer", {
      date: "2024-02-26", type: "transfer", category: "management", toAssetId: "asset-cash",
    }),
    expense("salary-category-expense", {
      date: "2024-02-24", category: "salary",
    }),
  ];
  assert.deepEqual(
    livingBudget([...regular, ...ignored], "DKK", "2024-02-29"),
    livingBudget(regular, "DKK", "2024-02-29"),
  );
  assert.equal(livingBudget(ignored, "DKK", "2024-02-29"), null);
  assert.equal(livingBudget([], "DKK", "2024-02-29"), null);
  assert.equal(livingBudget([salary("2024-03-01")], "DKK", "2024-02-29"), null);
});

test("living budgets convert savings at the salary rate and expenses at their own rate", () => {
  const transactions = [
    salary("2024-02-25", 400_000, { currency: "USD" }),
    expense("usd-expense", {
      date: "2024-02-26", currency: "USD", amountMinor: 10_000,
      fx: { ...base.fx, rates: { DKK: 1, USD: 0.25 } },
    }),
  ];
  const result = livingBudget(transactions, "USD", "2024-02-29")!;
  assert.equal(result.salary, 400_000);
  assert.equal(result.savings, 100_000);
  assert.equal(result.expense, 10_000);
  assert.equal(result.remaining, 290_000);
  assert.equal(livingBudget(transactions, "DKK", "2024-02-29")!.remaining, 1_460_000);
  const missing = livingBudget(transactions, "EUR", "2024-02-29")!;
  assert.equal(missing.budget, null);
  assert.equal(missing.remaining, null);
  const priorMissing = [
    salary("2024-01-25"),
    expense("missing", { date: "2024-01-26", currency: "EUR" }),
    ...transactions,
  ];
  assert.equal(livingBudget(priorMissing, "DKK", "2024-02-29")!.remaining, null);
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
