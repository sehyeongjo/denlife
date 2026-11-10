import {
  DEFAULT_ASSET,
  convertedMinor,
  isManagement,
  type Transaction,
} from "./ledger.ts";

export type PeriodMode = "month" | "year";

export function periodTransactions(
  transactions: Transaction[],
  month: string,
  mode: PeriodMode,
) {
  const prefix = mode === "year" ? month.slice(0, 4) : month;
  return transactions
    .filter((item) => item.date.startsWith(prefix))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
}

export function withInitialSalary(
  transactions: Transaction[],
  assetId = "",
): Transaction[] {
  const initialDate = "2026-11-01";
  if (
    (assetId && assetId !== DEFAULT_ASSET.id) ||
    transactions.some(
      (item) =>
        item.type === "income" &&
        item.category === "salary" &&
        item.date <= initialDate,
    )
  )
    return transactions;
  // shortcut: use the first recorded FX for the initial salary; an actual October salary entry supplies its own rate.
  const firstEntry = transactions
    .filter((item) => item.date >= initialDate)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )[0];
  return [
    ...transactions,
    {
      id: "initial-salary-2026-10",
      assetId: DEFAULT_ASSET.id,
      type: "income",
      category: "salary",
      title: "2026년 10월 급여 · 생활비 초기값",
      date: initialDate,
      createdAt: `${initialDate}T00:00:00Z`,
      amountMinor: 2_415_038,
      currency: "DKK",
      note: "",
      fx: firstEntry?.fx ?? {
        base: "DKK",
        rates: { DKK: 1 },
        dates: { DKK: initialDate },
        fetchedAt: `${initialDate}T00:00:00Z`,
        source: "manual",
      },
    },
  ];
}

export function livingBudget(
  transactions: Transaction[],
  currency: string,
  asOf: string,
  assetId = "",
  period?: string,
) {
  const entries = withInitialSalary(transactions, assetId).filter(
    (item) =>
      item.date <= asOf &&
      ((item.type === "income" && item.category === "salary") ||
        (item.type === "expense" && !isManagement(item))),
  );
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(b.type === "income") - Number(a.type === "income") ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const openingPayday =
    asOf >= "2026-11-01" && (!assetId || assetId === DEFAULT_ASSET.id)
      ? entries.findLast(
          (item) => item.type === "income" && item.date <= "2026-11-01",
        )?.date
      : undefined;
  let cycle = {
    start: "",
    salary: 0,
    savings: 0,
    previousDeficit: 0,
    priorSpending: 0,
    expense: 0,
  };
  let missing = 0;
  for (const item of entries) {
    if (item.type === "income" && item.date !== cycle.start) {
      const previousDeficit = Math.max(
        0,
        cycle.expense + cycle.priorSpending + cycle.savings +
          cycle.previousDeficit - cycle.salary,
      );
      const savings = convertedMinor(
        { ...item, currency: "DKK", amountMinor: 500_000 },
        currency,
      );
      if (savings === null) missing++;
      const priorSpending =
        item.date === openingPayday
          ? convertedMinor(
              { ...item, currency: "DKK", amountMinor: 785_842 },
              currency,
            )
          : 0;
      if (priorSpending === null) missing++;
      cycle = {
        start: item.date,
        salary: 0,
        savings: savings ?? 0,
        previousDeficit,
        priorSpending: priorSpending ?? 0,
        expense: 0,
      };
    }
    if (!cycle.start) continue;
    const amount = convertedMinor(item, currency);
    if (amount === null) missing++;
    else if (item.type === "income") cycle.salary += amount;
    else cycle.expense += amount;
  }
  if (!cycle.start || (period && !cycle.start.startsWith(period))) return null;
  const budget = cycle.salary - cycle.savings - cycle.previousDeficit;
  const nextPayday = transactions
    .filter(
      (item) =>
        item.type === "income" &&
        item.category === "salary" &&
        item.date > asOf,
    )
    .map((item) => item.date)
    .sort()[0];
  return {
    ...cycle,
    nextPayday,
    budget: missing ? null : budget,
    remaining: missing ? null : budget - cycle.expense - cycle.priorSpending,
  };
}

export function categoryBreakdown(
  transactions: Transaction[],
  currency: string,
  type: Exclude<Transaction["type"], "transfer">,
) {
  const amounts = new Map<string, number>();
  let total = 0;
  let missing = 0;
  for (const item of transactions) {
    if (isManagement(item) || item.type !== type) continue;
    const amount = convertedMinor(item, currency);
    if (amount === null) {
      missing++;
      continue;
    }
    total += amount;
    amounts.set(item.category, (amounts.get(item.category) ?? 0) + amount);
  }
  return {
    total,
    missing,
    items: [...amounts]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({
        category,
        amount,
        percent: (amount / total) * 100,
      })),
  };
}

export function cashflowTrend(
  transactions: Transaction[],
  currency: string,
  month: string,
  mode: PeriodMode,
) {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = mode === "year" ? 12 : new Date(year, monthNumber, 0).getDate();
  const points = Array.from({ length: count }, (_, index) => ({
    key:
      mode === "year"
        ? `${year}-${String(index + 1).padStart(2, "0")}`
        : `${month}-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1}${mode === "year" ? "월" : "일"}`,
    income: 0,
    expense: 0,
  }));
  const byKey = new Map(points.map((point) => [point.key, point]));
  let missing = 0;
  for (const item of transactions) {
    if (isManagement(item) || item.type === "transfer") continue;
    const point = byKey.get(
      mode === "year" ? item.date.slice(0, 7) : item.date,
    );
    if (!point) continue;
    const amount = convertedMinor(item, currency);
    if (amount === null) {
      missing++;
      continue;
    }
    point[item.type] += amount;
  }
  return { points, missing };
}
