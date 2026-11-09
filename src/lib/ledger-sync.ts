import { categoryLabelKey, parseLedger, type Ledger } from "./ledger.ts";

export type LedgerState = { ledger: Ledger; revision: number };
export const MIGRATION_KEY = "denlife.ledger.v1.neon-migrated";

export function parseLedgerState(value: unknown): LedgerState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ledger" in value) ||
    !("revision" in value) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error("가계부 응답을 확인할 수 없어요.");
  return {
    ledger: parseLedger(JSON.stringify(value.ledger)),
    revision: value.revision,
  };
}

export function mergeLocalLedger(remote: Ledger, local: Ledger): Ledger {
  const remoteIds = new Set(remote.transactions.map((item) => item.id));
  const assets = [...remote.assets];
  const assetIds = new Map<string, string>();
  for (const asset of local.assets) {
    const existing = assets.find(
      (item) =>
        item.id === asset.id ||
        categoryLabelKey(item.label) === categoryLabelKey(asset.label),
    );
    assetIds.set(asset.id, existing?.id ?? asset.id);
    if (!existing) assets.push(asset);
  }
  const customCategories = [...remote.customCategories];
  const categoryIds = new Map<string, string>();
  for (const category of local.customCategories) {
    const existing = customCategories.find(
      (item) =>
        item.id === category.id ||
        categoryLabelKey(item.label) === categoryLabelKey(category.label),
    );
    categoryIds.set(category.id, existing?.id ?? category.id);
    if (!existing) customCategories.push(category);
  }
  return {
    ...remote,
    started: true,
    currencies: [...new Set([...remote.currencies, ...local.currencies])],
    customCategories,
    assets,
    transactions: [
      ...remote.transactions,
      ...local.transactions
        .filter((item) => !remoteIds.has(item.id))
        .map((item) => ({
          ...item,
          assetId: assetIds.get(item.assetId) ?? item.assetId,
          ...(item.toAssetId
            ? { toAssetId: assetIds.get(item.toAssetId) ?? item.toAssetId }
            : {}),
          category: categoryIds.get(item.category) ?? item.category,
        })),
    ],
  };
}
