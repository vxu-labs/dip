import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, cases } from "./longitudinal-fixtures.mjs";
// Evaluate only the source-hashed, reviewed pure oracle function owned by this repository.
// Participant artifacts and model text are never passed to this constructor.
const source = fs.readFileSync(
  new URL("./longitudinal-stress.mjs", import.meta.url),
  "utf8",
);
const protocol = JSON.parse(
  fs.readFileSync(
    new URL(
      "../docs/benchmarks/2026-10-06-longitudinal-stress-protocol.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.equal(
  createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"),
  protocol.sourceHash,
);
const start = source.indexOf("function oracle(c) {"),
  end = source.indexOf("function evaluate(");
assert.ok(start >= 0 && end > start);
const oracle = new Function(
  "return (" + source.slice(start, end).trim() + ");",
)();
let checked = 0;
for (let index = 0; index < 4; index++) {
  const contract = fixture(index).final,
    ref = oracle(contract);
  for (const test of cases(ref, contract)) {
    test.fn();
    checked++;
  }
  const cart = [{ sku: "constructor", quantity: 2, unitPriceCents: 0 }];
  assert.throws(() => ref.reserveInventory({}, cart), {
    name: "RangeError",
    message: "insufficient stock",
  });
  checked++;
  const stock = Object.fromEntries([
    ["constructor", 3],
    ["__proto__", 4],
  ]);
  assert.deepEqual(
    ref.reserveInventory(stock, [
      ...cart,
      { sku: "__proto__", quantity: 1, unitPriceCents: 7 },
    ]),
    Object.fromEntries([
      ["constructor", 1],
      ["__proto__", 3],
    ]),
  );
  checked++;
  assert.deepEqual(
    stock,
    Object.fromEntries([
      ["constructor", 3],
      ["__proto__", 4],
    ]),
  );
  checked++;
}
console.log(
  JSON.stringify({
    independentPrimaryAndDictionaryChecks: checked,
    modelCalls: 0,
  }),
);
