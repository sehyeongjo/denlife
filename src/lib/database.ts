import { neon } from "@neondatabase/serverless";
import { isDeepStrictEqual } from "node:util";
import { newLedger, type Ledger } from "./ledger.ts";
import { parseLedgerState, type LedgerState } from "./ledger-sync.ts";

export const MAIN_LEDGER = "main";

export class LedgerConflictError extends Error {}
export class InvalidLedgerUpdateError extends Error {}

export function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return neon(connectionString, {
    fetchOptions: { signal: AbortSignal.timeout(15_000), cache: "no-store" },
  });
}

// shortcut: this personal app stores one JSONB document; split transactions and paginate before the ledger reaches 4 MB.
export async function initializeDatabase() {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const sql = neon(connectionString, {
    fetchOptions: { signal: AbortSignal.timeout(20_000) },
  });
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS denlife_ledgers (
      id text PRIMARY KEY,
      data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
      revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    sql`INSERT INTO denlife_ledgers (id, data) VALUES (${MAIN_LEDGER}, ${JSON.stringify(newLedger())}::jsonb) ON CONFLICT (id) DO NOTHING`,
  ]);
}

export async function readLedger(id: string): Promise<LedgerState> {
  const sql = database();
  const rows =
    await sql`SELECT data AS ledger, revision FROM denlife_ledgers WHERE id = ${id}`;
  if (!rows[0]) throw new Error("Ledger is not initialized");
  return parseLedgerState(rows[0]);
}

export function validateLedgerUpdate(current: Ledger, next: Ledger): void {
  const existing = new Map(current.transactions.map((item) => [item.id, item]));
  for (const transaction of next.transactions) {
    const previous = existing.get(transaction.id);
    if (
      previous &&
      (previous.createdAt !== transaction.createdAt ||
        !isDeepStrictEqual(previous.fx, transaction.fx))
    )
      throw new InvalidLedgerUpdateError(
        "기존 내역의 등록 일시와 환율은 변경할 수 없어요.",
      );
  }
}

export async function writeLedger(
  id: string,
  state: LedgerState,
): Promise<LedgerState> {
  const validated = parseLedgerState(state);
  const ledger = validated.ledger;
  const current = await readLedger(id);
  if (current.revision !== validated.revision) throw new LedgerConflictError();
  validateLedgerUpdate(current.ledger, ledger);
  const sql = database();
  const rows = await sql`UPDATE denlife_ledgers
    SET data = ${JSON.stringify(ledger)}::jsonb, revision = revision + 1, updated_at = now()
    WHERE id = ${id} AND revision = ${validated.revision}
    RETURNING data AS ledger, revision`;
  if (!rows[0]) throw new LedgerConflictError();
  return parseLedgerState(rows[0]);
}
