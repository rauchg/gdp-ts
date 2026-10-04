import assert from "node:assert/strict";
import { test } from "node:test";
import { defineProof, name } from "../src/index.ts";

test("name passes values through and returns the callback result", () => {
  assert.equal(name(41, (a) => a.value + 1), 42);
  assert.equal(name("a", "b", (a, b) => a.value + b.value), "ab");
  assert.equal(name(1, 2, 3, (a, b, c) => a.value + b.value + c.value), 6);
});

test("name works with async callbacks", async () => {
  assert.equal(await name(1, async (a) => a.value * 2), 2);
});

test("named values are frozen", () => {
  name({ id: 1 }, (a) => {
    assert.ok(Object.isFrozen(a));
    assert.deepEqual(a.value, { id: 1 });
  });
});

test("proofs are a frozen singleton carrying only their kind", () => {
  const IsEven = defineProof("IsEven");
  assert.equal(IsEven.kind, "IsEven");
  name(2, 4, (a, b) => {
    const p1 = IsEven.prove(a);
    const p2 = IsEven.prove(b);
    assert.equal(p1, p2);
    assert.deepEqual({ ...p1 }, { kind: "IsEven" });
    assert.ok(Object.isFrozen(p1));
  });
});
