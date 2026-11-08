import { parseLedger, type Ledger } from "./ledger.ts";

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
  return {
    ...remote,
    started: true,
    currencies: [...new Set([...remote.currencies, ...local.currencies])],
    transactions: [
      ...remote.transactions,
      ...local.transactions.filter((item) => !remoteIds.has(item.id)),
    ],
  };
}
