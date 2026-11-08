export const DEFAULT_CURRENCIES = ["DKK", "KRW", "USD", "JPY", "EUR"];
export const STORAGE_KEY = "denlife.ledger.v1";
export const CATEGORIES = {
  food: { label: "식비", color: "#bedc8b", icon: "utensils" },
  grocery: { label: "장보기", color: "#899f7c", icon: "basket" },
  transport: { label: "교통", color: "#b7c5d6", icon: "train" },
  shopping: { label: "쇼핑", color: "#e7c6ad", icon: "bag" },
  home: { label: "주거 · 생활", color: "#c4b7d3", icon: "home" },
  leisure: { label: "여가", color: "#e4d18e", icon: "coffee" },
  salary: { label: "급여", color: "#a9c8b0", icon: "wallet" },
  other: { label: "기타", color: "#c7cac5", icon: "dots" },
} as const;

export type Category = string;
export type CustomCategory = { id: string; label: string };
export const CATEGORY_COLORS = [
  "#3182f6",
  "#f5a524",
  "#34b89a",
  "#9b7ae8",
  "#ef788c",
  "#54afcf",
  "#b99b62",
  "#7d8ca3",
];
export const categoryLabelKey = (label: string) =>
  label.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");

export function categoryOptions(customCategories: CustomCategory[]) {
  return [
    ...Object.entries(CATEGORIES).map(([id, data], index) => ({
      ...data,
      id,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    })),
    ...customCategories.map(({ id, label }, index) => ({
      id,
      label,
      icon: "dots",
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    })),
  ];
}

export function categoryInfo(id: string, customCategories: CustomCategory[]) {
  return (
    categoryOptions(customCategories).find(
      (category) => category.id === id,
    ) ?? { id, ...CATEGORIES.other }
  );
}
export type RateSnapshot = {
  base: "DKK";
  rates: Record<string, number>;
  dates: Record<string, string>;
  fetchedAt: string;
  source: "frankfurter" | "manual" | "demo";
};
export type Transaction = {
  id: string;
  type: "expense" | "income";
  title: string;
  amountMinor: number;
  currency: string;
  category: Category;
  date: string;
  note: string;
  createdAt: string;
  fx: RateSnapshot;
};
export type Ledger = {
  version: 1;
  started: boolean;
  currencies: string[];
  displayCurrency: string;
  customCategories: CustomCategory[];
  transactions: Transaction[];
};

export const currencyNames = new Intl.DisplayNames(["ko"], {
  type: "currency",
});
export const currencyName = (code: string) => currencyNames.of(code) || code;
export const currencyFlag = (code: string) =>
  ({
    DKK: "🇩🇰",
    KRW: "🇰🇷",
    USD: "🇺🇸",
    JPY: "🇯🇵",
    EUR: "🇪🇺",
    GBP: "🇬🇧",
    SEK: "🇸🇪",
    NOK: "🇳🇴",
    CHF: "🇨🇭",
    CAD: "🇨🇦",
    AUD: "🇦🇺",
    CNY: "🇨🇳",
  })[code] || "🌐";
export const fractionDigits = (currency: string) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
export const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
export const monthKey = () => today().slice(0, 7);
export const shiftMonth = (month: string, delta: number) => {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export function newLedger(): Ledger {
  return {
    version: 1,
    started: true,
    currencies: [...DEFAULT_CURRENCIES],
    displayCurrency: "DKK",
    customCategories: [],
    transactions: [],
  };
}

export function parseAmount(value: string, currency: string): number | null {
  const decimals = fractionDigits(currency);
  const pattern = decimals
    ? new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`)
    : /^\d+$/;
  if (!pattern.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 10 ** decimals);
  return Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= 1_000_000_000_000
    ? amount
    : null;
}

// Rates are units per DKK. Always use the transaction's immutable registration snapshot.
export function convertedMinor(
  transaction: Transaction,
  target: string,
): number | null {
  if (transaction.currency === target) return transaction.amountMinor;
  const from = transaction.fx.rates[transaction.currency];
  const to = transaction.fx.rates[target];
  if (!(from > 0) || !(to > 0)) return null;
  const value = Math.round(
    (transaction.amountMinor /
      10 ** fractionDigits(transaction.currency) /
      from) *
      to *
      10 ** fractionDigits(target),
  );
  return Number.isSafeInteger(value) ? value : null;
}

export function totals(transactions: Transaction[], currency: string) {
  let income = 0,
    expense = 0,
    missing = 0;
  for (const transaction of transactions) {
    const value = convertedMinor(transaction, currency);
    if (value === null) {
      missing++;
      continue;
    }
    if (transaction.type === "income") income += value;
    else expense += value;
  }
  return { income, expense, balance: income - expense, missing };
}

export function money(
  minor: number,
  currency: string,
  compact = false,
): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: compact ? 0 : fractionDigits(currency),
    maximumFractionDigits: compact ? 0 : fractionDigits(currency),
  }).format(minor / 10 ** fractionDigits(currency));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const validCode = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Z]{3}$/.test(value) &&
  Intl.supportedValuesOf("currency").includes(value);
const validDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export function validSnapshot(value: unknown): value is RateSnapshot {
  if (
    !isRecord(value) ||
    value.base !== "DKK" ||
    !isRecord(value.rates) ||
    !isRecord(value.dates) ||
    typeof value.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(value.fetchedAt)) ||
    !["frankfurter", "manual", "demo"].includes(String(value.source))
  )
    return false;
  if (value.rates.DKK !== 1) return false;
  // Preserve newer quote codes even when a phone's Intl currency catalogue is older than the server's.
  return Object.entries(value.rates).every(
    ([code, rate]) =>
      /^[A-Z]{3}$/.test(code) &&
      typeof rate === "number" &&
      Number.isFinite(rate) &&
      rate > 0 &&
      validDate((value.dates as Record<string, unknown>)[code]),
  );
}

export function parseLedger(raw: string): Ledger {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.started !== "boolean" ||
    !Array.isArray(value.currencies) ||
    !value.currencies.length ||
    !value.currencies.every(validCode) ||
    new Set(value.currencies).size !== value.currencies.length ||
    !value.currencies.includes("DKK") ||
    !validCode(value.displayCurrency) ||
    !value.currencies.includes(value.displayCurrency) ||
    !Array.isArray(value.transactions)
  )
    throw new Error("올바른 가계부 데이터가 아닙니다.");
  // Old DB records and browser backups predate custom categories.
  const customCategories =
    value.customCategories === undefined ? [] : value.customCategories;
  if (!Array.isArray(customCategories))
    throw new Error("카테고리 데이터를 읽을 수 없습니다.");
  const categoryIds = new Set(Object.keys(CATEGORIES));
  const categoryLabels = new Set(
    Object.values(CATEGORIES).map(({ label }) => categoryLabelKey(label)),
  );
  for (const category of customCategories) {
    if (
      !isRecord(category) ||
      typeof category.id !== "string" ||
      !/^custom-[a-zA-Z0-9-]{1,64}$/.test(category.id) ||
      categoryIds.has(category.id) ||
      typeof category.label !== "string" ||
      !category.label.trim() ||
      category.label !== category.label.trim() ||
      category.label.length > 30 ||
      categoryLabels.has(categoryLabelKey(category.label))
    )
      throw new Error("카테고리 이름이 중복되거나 올바르지 않습니다.");
    categoryIds.add(category.id);
    categoryLabels.add(categoryLabelKey(category.label));
  }
  const ids = new Set<string>();
  for (const transaction of value.transactions) {
    if (
      !isRecord(transaction) ||
      typeof transaction.id !== "string" ||
      !transaction.id ||
      ids.has(transaction.id) ||
      !["income", "expense"].includes(String(transaction.type)) ||
      typeof transaction.title !== "string" ||
      !transaction.title.trim() ||
      transaction.title.length > 80 ||
      typeof transaction.amountMinor !== "number" ||
      !Number.isSafeInteger(transaction.amountMinor) ||
      transaction.amountMinor <= 0 ||
      transaction.amountMinor > 1_000_000_000_000 ||
      !validCode(transaction.currency) ||
      typeof transaction.category !== "string" ||
      !categoryIds.has(transaction.category) ||
      !validDate(transaction.date) ||
      typeof transaction.note !== "string" ||
      transaction.note.length > 500 ||
      typeof transaction.createdAt !== "string" ||
      Number.isNaN(Date.parse(transaction.createdAt)) ||
      !validSnapshot(transaction.fx) ||
      !transaction.fx.rates[transaction.currency]
    )
      throw new Error("저장된 거래 내역을 읽을 수 없습니다.");
    ids.add(transaction.id);
  }
  return { ...value, customCategories } as Ledger;
}

export function normalizeRates(
  rows: unknown,
  fetchedAt = new Date().toISOString(),
): RateSnapshot {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("환율 응답이 비어 있어요.");
  const snapshot: RateSnapshot = {
    base: "DKK",
    rates: { DKK: 1 },
    dates: { DKK: fetchedAt.slice(0, 10) },
    fetchedAt,
    source: "frankfurter",
  };
  for (const row of rows) {
    if (
      !isRecord(row) ||
      row.base !== "DKK" ||
      !validCode(row.quote) ||
      typeof row.rate !== "number" ||
      !Number.isFinite(row.rate) ||
      row.rate <= 0 ||
      !validDate(row.date)
    )
      continue;
    snapshot.rates[row.quote] = row.rate;
    snapshot.dates[row.quote] = row.date;
  }
  if (!DEFAULT_CURRENCIES.every((code) => snapshot.rates[code]))
    throw new Error("기본 통화 환율을 불러오지 못했어요.");
  return snapshot;
}

export function demoTransactions(month: string): Transaction[] {
  const fx: RateSnapshot = {
    base: "DKK",
    rates: {
      DKK: 1,
      KRW: 202.74,
      USD: 0.1498,
      JPY: 23.697,
      EUR: 0.13362,
      GBP: 0.115,
      SEK: 1.43,
      NOK: 1.54,
    },
    dates: Object.fromEntries(
      ["DKK", "KRW", "USD", "JPY", "EUR", "GBP", "SEK", "NOK"].map((code) => [
        code,
        `${month}-01`,
      ]),
    ),
    fetchedAt: `${month}-01T09:00:00Z`,
    source: "demo",
  };
  const day = Math.min(
    28,
    month === monthKey() ? Number(today().slice(-2)) : 28,
  );
  const entries: [
    string,
    number,
    string,
    Category,
    number,
    "expense" | "income",
  ][] = [
    ["월급", 2850000, "DKK", "salary", 1, "income"],
    ["11월의 보금자리", 850000, "DKK", "home", 1, "expense"],
    ["주말 장보기 · Netto", 32850, "DKK", "grocery", day, "expense"],
    ["커피 한 잔 · Coffee Collective", 4500, "DKK", "food", day, "expense"],
    [
      "한국에서 주문한 책",
      42000,
      "KRW",
      "shopping",
      Math.max(1, day - 1),
      "expense",
    ],
    [
      "시내로 가는 기차",
      4800,
      "DKK",
      "transport",
      Math.max(1, day - 1),
      "expense",
    ],
    ["친구와 저녁 식사", 38500, "DKK", "food", Math.max(1, day - 2), "expense"],
    ["Spotify", 1099, "EUR", "leisure", Math.max(1, day - 3), "expense"],
    [
      "작은 프리랜스 프로젝트",
      25000,
      "USD",
      "other",
      Math.max(1, day - 4),
      "income",
    ],
  ];
  return entries.map(
    ([title, amountMinor, currency, category, date, type], i) => ({
      id: `demo-${i}`,
      title: title.replace("11월", `${Number(month.slice(-2))}월`),
      amountMinor,
      currency,
      category,
      date: `${month}-${String(date).padStart(2, "0")}`,
      type,
      note: "화면을 둘러보기 위한 샘플 거래입니다.",
      createdAt: `${month}-01T09:00:00Z`,
      fx,
    }),
  );
}
