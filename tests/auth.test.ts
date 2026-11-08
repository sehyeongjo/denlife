import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  configuredPassword,
  LoginLimiter,
  passwordMatches,
  sameOrigin,
  SESSION_SECONDS,
  verifySession,
} from "../src/lib/auth.ts";

test("an unset password fails closed without a built-in default", () => {
  const previous = process.env.APP_PASSWORD;
  try {
    delete process.env.APP_PASSWORD;
    assert.equal(configuredPassword(), undefined);
    process.env.APP_PASSWORD = "";
    assert.equal(configuredPassword(), undefined);
    process.env.APP_PASSWORD = "chosen-password";
    assert.equal(configuredPassword(), "chosen-password");
  } finally {
    if (previous === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previous;
  }
});

test("password comparison rejects wrong and empty input", () => {
  assert.equal(passwordMatches("test", "test"), true);
  assert.equal(passwordMatches("wrong", "test"), false);
  assert.equal(passwordMatches("", "test"), false);
});

test("sessions expire, resist tampering and become invalid after a password change", () => {
  const now = Date.UTC(2026, 10, 8);
  const token = createSession("test", now);
  assert.equal(verifySession(token, "test", now), true);
  assert.equal(verifySession(token, "changed", now), false);
  assert.equal(
    verifySession(token, "test", now + SESSION_SECONDS * 1000),
    false,
  );
  const [expires, nonce, mac] = token.split(".");
  assert.equal(
    verifySession(`${Number(expires) + 1}.${nonce}.${mac}`, "test", now),
    false,
  );
  assert.equal(
    verifySession(`${expires}.${nonce}.${mac.slice(0, -3)}abc`, "test", now),
    false,
  );
  assert.equal(verifySession(undefined, "test", now), false);
  assert.equal(verifySession(token, undefined, now), false);
  assert.equal(verifySession("true", "test", now), false);
  assert.notEqual(createSession("test", now), token);
});

test("only same-origin authentication requests are accepted", () => {
  assert.equal(
    sameOrigin(
      new Request("https://denlife.example/api/auth/login", {
        headers: { origin: "https://denlife.example" },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      new Request("https://denlife.example/api/auth/login", {
        headers: { origin: "https://attacker.example" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(new Request("https://denlife.example/api/auth/login")),
    false,
  );
});

test("repeated login attempts are throttled and recover after the window or successful login", () => {
  const limiter = new LoginLimiter();
  for (let i = 0; i < 5; i++) assert.equal(limiter.attempt("ip", 1000), 0);
  assert.equal(limiter.attempt("ip", 1000), 60);
  assert.equal(limiter.attempt("ip", 61_000), 0);
  limiter.clear("ip");
  assert.equal(limiter.attempt("ip", 62_000), 0);
  assert.equal(limiter.attempt("other-ip", 1000), 0);
});
