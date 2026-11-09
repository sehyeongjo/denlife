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
import {
  demoTransactions,
  newLedger,
  totals,
  type Transaction,
} from "../src/lib/ledger.ts";

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
      delete legacyLedger.assets;
      await sql`INSERT INTO denlife_ledgers (id, data) VALUES (${id}, ${JSON.stringify(legacyLedger)}::jsonb)`;
      let current = await readLedger(id);
      assert.deepEqual(current.ledger.customCategories, []);
      assert.deepEqual(current.ledger.assets, newLedger().assets);
      const customCategory = { id: "custom-integration", label: "여행" };
      const asset = { id: "asset-integration", label: "생활비 통장" };
      const sample = {
        ...demoTransactions("2026-11")[0],
        id: randomUUID(),
        title: "'; DROP TABLE denlife_ledgers; --",
        category: customCategory.id,
        assetId: asset.id,
      };
      current = await writeLedger(id, {
        ledger: {
          ...current.ledger,
          customCategories: [customCategory],
          assets: [...current.ledger.assets, asset],
          transactions: [sample],
        },
        revision: current.revision,
      });
      assert.equal(current.revision, 1);
      const persisted = await readLedger(id);
      assert.deepEqual(persisted.ledger.transactions[0], sample);
      assert.deepEqual(persisted.ledger.customCategories, [customCategory]);
      assert.deepEqual(persisted.ledger.assets, [...newLedger().assets, asset]);
      await assert.rejects(
        writeLedger(id, {
          ...persisted,
          ledger: { ...persisted.ledger, assets: newLedger().assets },
        }),
      );
      current = await writeLedger(id, {
        ledger: {
          ...current.ledger,
          transactions: [{ ...sample, amountMinor: 12345, assetId: "default" }],
        },
        revision: current.revision,
      });
      assert.equal(current.ledger.transactions[0].amountMinor, 12345);
      assert.equal(current.ledger.transactions[0].assetId, "default");
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
      current = await readLedger(id);
      current = await writeLedger(id, {
        ...current,
        ledger: {
          ...current.ledger,
          transactions: current.ledger.transactions.map((item) => ({
            ...item,
            category: "management",
          })),
        },
      });
      const management = await readLedger(id);
      assert.equal(management.ledger.transactions[0].category, "management");
      assert.deepEqual(totals(management.ledger.transactions, "DKK"), {
        income: 0,
        expense: 0,
        balance: sample.amountMinor,
        missing: 0,
      });
      assert.deepEqual(management.ledger.transactions[0].fx, sample.fx);
      const transfer: Transaction = {
        ...sample,
        id: randomUUID(),
        type: "transfer",
        category: "management",
        assetId: "default",
        toAssetId: asset.id,
        amountMinor: 5000,
      };
      current = await writeLedger(id, {
        ...management,
        ledger: {
          ...management.ledger,
          transactions: [...management.ledger.transactions, transfer],
        },
      });
      const transferred = await readLedger(id);
      assert.deepEqual(transferred.ledger.transactions[1], transfer);
      assert.equal(
        totals(transferred.ledger.transactions, "DKK").balance,
        sample.amountMinor,
      );
      assert.equal(
        totals(transferred.ledger.transactions, "DKK", "default").balance,
        -5000,
      );
      assert.equal(
        totals(transferred.ledger.transactions, "DKK", asset.id).balance,
        sample.amountMinor + 5000,
      );
      await assert.rejects(
        writeLedger(id, {
          ...transferred,
          ledger: { ...transferred.ledger, assets: newLedger().assets },
        }),
      );
      current = await writeLedger(id, {
        ...current,
        ledger: {
          ...current.ledger,
          transactions: current.ledger.transactions.map((item) =>
            item.id === transfer.id
              ? {
                  ...item,
                  amountMinor: 2000,
                  assetId: asset.id,
                  toAssetId: "default",
                }
              : item,
          ),
        },
      });
      assert.equal(
        totals(current.ledger.transactions, "DKK", "default").balance,
        2000,
      );
      assert.equal(
        totals(current.ledger.transactions, "DKK", asset.id).balance,
        sample.amountMinor - 2000,
      );
      assert.deepEqual(current.ledger.transactions[1].fx, transfer.fx);
      current = await writeLedger(id, {
        ...current,
        ledger: {
          ...current.ledger,
          transactions: current.ledger.transactions.filter(
            (item) => item.id !== transfer.id,
          ),
        },
      });
      assert.deepEqual(
        current.ledger.transactions,
        management.ledger.transactions,
      );
    } catch (error) {
      if (error instanceof AssertionError) throw error;
      throw new Error(
        "Neon integration test failed. Check database connectivity and schema.",
      );
    }
  },
);
