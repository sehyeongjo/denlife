import { convertedMinor, isManagement, type Transaction } from "./ledger.ts";

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
