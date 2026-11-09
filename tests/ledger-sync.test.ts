import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoTransactions,
  newLedger,
  type Transaction,
} from "../src/lib/ledger.ts";
import { mergeLocalLedger, parseLedgerState } from "../src/lib/ledger-sync.ts";
import { validateLedgerUpdate } from "../src/lib/database.ts";

test("server state validates revision and ledger before saving", () => {
  const ledger = newLedger();
  assert.deepEqual(parseLedgerState({ ledger, revision: 3 }), {
    ledger,
    revision: 3,
  });
  for (const revision of [-1, 1.5, "2", null, Infinity])
    assert.throws(() => parseLedgerState({ ledger, revision }));
  assert.throws(() => parseLedgerState({ ledger: {}, revision: 0 }));
});

test("local migration merges new records and currencies without overwriting server records", () => {
  const samples = demoTransactions("2026-11");
  const remote = { ...newLedger(), transactions: [samples[0]] };
  const local = {
    ...newLedger(),
    currencies: [...newLedger().currencies, "SEK"],
    transactions: [{ ...samples[0], title: "older local title" }, samples[1]],
  };
  const merged = mergeLocalLedger(remote, local);
  assert.equal(merged.transactions.length, 2);
  assert.equal(merged.transactions[0].title, remote.transactions[0].title);
  assert.ok(merged.currencies.includes("SEK"));
  assert.deepEqual(mergeLocalLedger(merged, local), merged);
});

test("updates preserve registration timestamps and FX snapshots", () => {
  const sample = demoTransactions("2026-11")[0];
  const current = { ...newLedger(), transactions: [sample] };
  assert.doesNotThrow(() =>
    validateLedgerUpdate(current, {
      ...current,
      transactions: [{ ...sample, title: "changed", amountMinor: 12345 }],
    }),
  );
  assert.doesNotThrow(() => validateLedgerUpdate(current, newLedger()));
  assert.throws(() =>
    validateLedgerUpdate(current, {
      ...current,
      transactions: [{ ...sample, createdAt: "2026-11-08T00:00:00Z" }],
    }),
  );
  assert.throws(() =>
    validateLedgerUpdate(current, {
      ...current,
      transactions: [
        {
          ...sample,
          fx: { ...sample.fx, rates: { ...sample.fx.rates, USD: 10 } },
        },
      ],
    }),
  );
});

test("migration preserves custom categories and remaps matching names to server IDs", () => {
  const remote = {
    ...newLedger(),
    customCategories: [{ id: "custom-server", label: "Travel" }],
  };
  const local = {
    ...newLedger(),
    customCategories: [
      { id: "custom-local", label: "travel" },
      { id: "custom-health", label: "건강" },
    ],
    transactions: [
      { ...demoTransactions("2026-11")[1], category: "custom-local" },
    ],
  };
  const merged = mergeLocalLedger(remote, local);
  assert.equal(merged.customCategories.length, 2);
  assert.equal(merged.transactions[0].category, "custom-server");
  assert.deepEqual(
    parseLedgerState({ ledger: merged, revision: 0 }).ledger,
    merged,
  );
  assert.deepEqual(mergeLocalLedger(merged, local), merged);
});

test("migration preserves asset assignments, matches names, and keeps server records", () => {
  const sample = demoTransactions("2026-11")[0];
  const remote = {
    ...newLedger(),
    assets: [...newLedger().assets, { id: "asset-server", label: "Cash" }],
    transactions: [{ ...sample, assetId: "asset-server" }],
  };
  const local = {
    ...newLedger(),
    assets: [
      ...newLedger().assets,
      { id: "asset-local", label: "cash" },
      { id: "asset-savings", label: "저축" },
    ],
    transactions: [
      sample,
      { ...sample, id: "local-cash", assetId: "asset-local" },
      { ...sample, id: "local-savings", assetId: "asset-savings" },
    ],
  };
  const merged = mergeLocalLedger(remote, local);
  assert.equal(merged.assets.length, 3);
  assert.deepEqual(
    merged.transactions.map((item) => item.assetId),
    ["asset-server", "asset-server", "asset-savings"],
  );
  assert.deepEqual(
    parseLedgerState({ ledger: merged, revision: 0 }).ledger,
    merged,
  );
  assert.deepEqual(mergeLocalLedger(merged, local), merged);
});

test("migration remaps both transfer endpoints and preserves its registration snapshot", () => {
  const remote = {
    ...newLedger(),
    assets: [...newLedger().assets, { id: "asset-server", label: "현금" }],
  };
  const transfer: Transaction = {
    ...demoTransactions("2026-11")[0],
    type: "transfer",
    category: "management",
    toAssetId: "asset-local",
  };
  const local = {
    ...newLedger(),
    assets: [...newLedger().assets, { id: "asset-local", label: "현금" }],
    transactions: [transfer],
  };
  const merged = mergeLocalLedger(remote, local);
  assert.equal(merged.transactions[0].toAssetId, "asset-server");
  assert.equal(merged.transactions[0].assetId, "default");
  assert.deepEqual(merged.transactions[0].fx, transfer.fx);
  assert.deepEqual(
    parseLedgerState({ ledger: merged, revision: 0 }).ledger,
    merged,
  );
  assert.deepEqual(mergeLocalLedger(merged, local), merged);
});
