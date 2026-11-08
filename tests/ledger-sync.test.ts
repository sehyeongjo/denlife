import { test } from "node:test";
import assert from "node:assert/strict";
import { demoTransactions, newLedger } from "../src/lib/ledger.ts";
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
