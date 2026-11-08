import { test } from "node:test";
import assert, { AssertionError } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  database,
  InvalidLedgerUpdateError,
  LedgerConflictError,
  readLedger,
  writeLedger,
} from "../src/lib/database.ts";
import { demoTransactions, newLedger } from "../src/lib/ledger.ts";

test(
  "Neon persists CRUD and snapshots, rejects stale writes, and parameterizes user text",
  { skip: process.env.RUN_DB_TESTS !== "1" },
  async (context) => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const id = `integration-${randomUUID()}`;
    const sql = database();
    context.after(async () => {
      try {
        await database()`DELETE FROM denlife_ledgers WHERE id = ${id}`;
      } catch {
        throw new Error(
          "Could not remove the isolated integration-test ledger.",
        );
      }
    });
    try {
      const legacyLedger: Partial<ReturnType<typeof newLedger>> = newLedger();
      delete legacyLedger.customCategories;
      await sql`INSERT INTO denlife_ledgers (id, data) VALUES (${id}, ${JSON.stringify(legacyLedger)}::jsonb)`;
      let current = await readLedger(id);
      assert.deepEqual(current.ledger.customCategories, []);
      const customCategory = { id: "custom-integration", label: "여행" };
      const sample = {
        ...demoTransactions("2026-11")[0],
        id: randomUUID(),
        title: "'; DROP TABLE denlife_ledgers; --",
        category: customCategory.id,
      };
      current = await writeLedger(id, {
        ledger: {
          ...current.ledger,
          customCategories: [customCategory],
          transactions: [sample],
        },
        revision: current.revision,
      });
      assert.equal(current.revision, 1);
      const persisted = await readLedger(id);
      assert.deepEqual(persisted.ledger.transactions[0], sample);
      assert.deepEqual(persisted.ledger.customCategories, [customCategory]);
      current = await writeLedger(id, {
        ledger: {
          ...current.ledger,
          transactions: [{ ...sample, amountMinor: 12345 }],
        },
        revision: current.revision,
      });
      assert.equal(current.ledger.transactions[0].amountMinor, 12345);
      assert.deepEqual(current.ledger.transactions[0].fx, sample.fx);
      await assert.rejects(
        writeLedger(id, { ledger: newLedger(), revision: 0 }),
        LedgerConflictError,
      );
      await assert.rejects(
        writeLedger(id, {
          ...current,
          ledger: {
            ...current.ledger,
            transactions: [
              { ...sample, fx: { ...sample.fx, rates: { DKK: 1 } } },
            ],
          },
        }),
        InvalidLedgerUpdateError,
      );
      current = await writeLedger(id, {
        ledger: { ...current.ledger, transactions: [] },
        revision: current.revision,
      });
      assert.equal(current.ledger.transactions.length, 0);
      const simultaneous = await Promise.allSettled([
        writeLedger(id, {
          ...current,
          ledger: {
            ...current.ledger,
            transactions: [{ ...sample, title: "writer one" }],
          },
        }),
        writeLedger(id, {
          ...current,
          ledger: {
            ...current.ledger,
            transactions: [{ ...sample, title: "writer two" }],
          },
        }),
      ]);
      assert.equal(
        simultaneous.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejected = simultaneous.find(
        (result) => result.status === "rejected",
      );
      assert.ok(
        rejected?.status === "rejected" &&
          rejected.reason instanceof LedgerConflictError,
      );
      assert.equal((await readLedger(id)).ledger.transactions.length, 1);
    } catch (error) {
      if (error instanceof AssertionError) throw error;
      throw new Error(
        "Neon integration test failed. Check database connectivity and schema.",
      );
    }
  },
);
