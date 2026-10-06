import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { fixture } from "./longitudinal-fixtures.mjs";
const workspace = fileURLToPath(new URL("../", import.meta.url));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const protocolFile = path.join(
  workspace,
  "docs/benchmarks/2026-10-06-longitudinal-stress-protocol.json",
);
const sourceHash = () =>
  hash(
    fs
      .readFileSync(fileURLToPath(import.meta.url), "utf8")
      .replaceAll("\r\n", "\n"),
  );
const iterations = 256;
const protocol = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  label:
    "Supplementary exploratory contract stress test, specified after the primary run began and after pair 1 primary outcomes, before inspecting participant implementation source or evaluating stress outcomes. Not the original preregistered primary endpoint.",
  seed: 41729,
  iterationsPerProject: iterations,
  checksPerIteration: 9,
  sourceHash: sourceHash(),
  policy:
    "Evaluate every final audited project under identical deterministic inputs. No participant feedback, code repair or model calls. Preserve every pass/fail flag; collect the first ten failure examples per group, including inputs. Calibrate against an independent built-in oracle and deliberately broken modules first.",
  inputs:
    "Bounded integer prices/quantities/shipping, fractional finite coupons, invalid lines, duplicate SKU/price combinations, trimmed Unicode and punctuation SKUs, own stock properties named __proto__/constructor/toString/hasOwnProperty, missing SKU stock, inclusive/expired/invalid return dates, comma/quote/newline receipt identifiers. No out-of-contract non-array cart, negative stock or unsafe numeric magnitudes.",
};
if (process.argv.includes("--protocol")) {
  fs.writeFileSync(protocolFile, JSON.stringify(protocol, null, 2) + "\n");
  console.log("Supplementary stress protocol saved before stress evaluation.");
  process.exit(0);
}
const registered = JSON.parse(fs.readFileSync(protocolFile, "utf8"));
protocol.createdAt = registered.createdAt;
assert.deepEqual(
  protocol,
  registered,
  "Supplementary stress source/protocol changed",
);
function random(seed) {
  let n = seed >>> 0;
  return () => {
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    return (n >>> 0) / 4294967296;
  };
}
function inputs() {
  const rng = random(protocol.seed),
    skus = [
      "a",
      " b ",
      "שלום",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "a,b",
      "x:y",
      ' quote" ',
      "\nline\n",
      "",
    ];
  return Array.from({ length: iterations }, (_, index) => {
    const cart = Array.from({ length: 1 + Math.floor(rng() * 8) }, () => ({
      sku: skus[Math.floor(rng() * skus.length)],
      quantity: Math.floor(rng() * 5),
      unitPriceCents: Math.floor(rng() * 401),
    }));
    if (index % 3 === 0)
      cart.push(
        null,
        { sku: "invalid", quantity: 1.5, unitPriceCents: 1 },
        { sku: 3, quantity: 1, unitPriceCents: 0 },
      );
    if (index % 4 === 0 && cart[0]) cart.push({ ...cart[0], quantity: 2 });
    const stock = Object.fromEntries(
      skus
        .filter((s) => s.trim() && rng() > 0.2)
        .map((s) => [s.trim(), Math.floor(rng() * 13)]),
    );
    return {
      index,
      cart,
      stock,
      options: {
        couponPercent: Math.floor(rng() * 241) / 2 - 20,
        shippingCents: Math.floor(rng() * 500),
      },
      id: ["simple", "a,b", 'quote"id', "line\nid", "שלום"][index % 5],
      status: index % 4 ? "delivered" : "pending",
      deliveredDay: index % 11 === 0 ? 1.5 : 5,
      age: (index % 37) - 2,
    };
  });
}
function oracle(c) {
  const normalizeCart = (cart) =>
    cart
      .filter(
        (l) =>
          l &&
          typeof l.sku === "string" &&
          l.sku.trim() &&
          Number.isInteger(l.quantity) &&
          l.quantity > 0 &&
          Number.isInteger(l.unitPriceCents) &&
          l.unitPriceCents >= 0,
      )
      .reduce((out, l) => {
        const sku = l.sku.trim(),
          old = out.find(
            (x) => x.sku === sku && x.unitPriceCents === l.unitPriceCents,
          );
        if (old) old.quantity += l.quantity;
        else
          out.push({
            sku,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
          });
        return out;
      }, []);
  const priceOrder = (cart, o = {}) => {
    const subtotalCents = normalizeCart(cart).reduce(
        (n, l) => n + l.quantity * l.unitPriceCents,
        0,
      ),
      discountCents = Math.round(
        (subtotalCents *
          Math.min(c.couponCapPercent, Math.max(0, o.couponPercent || 0))) /
          100,
      ),
      taxCents = Math.round(
        ((subtotalCents - discountCents) * c.taxRatePercent) / 100,
      ),
      shippingCents = o.shippingCents || 0;
    return {
      subtotalCents,
      discountCents,
      taxCents,
      shippingCents,
      totalCents: subtotalCents - discountCents + taxCents + shippingCents,
    };
  };
  const buildReceipt = (o) => ({
    orderId: o.id,
    ...priceOrder(o.cart, o.options),
    itemCount: normalizeCart(o.cart).reduce((n, l) => n + l.quantity, 0),
    currency: c.currency,
  });
  const reserveInventory = (stock, cart) => {
    const needed = normalizeCart(cart).reduce((out, l) => {
      out.set(l.sku, (out.get(l.sku) || 0) + l.quantity);
      return out;
    }, new Map());
    for (const [sku, quantity] of needed)
      if (!Object.hasOwn(stock, sku) || stock[sku] < quantity)
        throw new RangeError("insufficient stock");
    const out = Object.fromEntries(Object.entries(stock));
    for (const [sku, quantity] of needed)
      Object.defineProperty(out, sku, {
        value: out[sku] - quantity,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    return out;
  };
  const canReturn = (o, { nowDay }) =>
    o.status !== "delivered"
      ? { eligible: false, reason: "status" }
      : !Number.isInteger(o.deliveredDay) ||
          o.deliveredDay < 0 ||
          !Number.isInteger(nowDay) ||
          nowDay < 0 ||
          nowDay < o.deliveredDay
        ? { eligible: false, reason: "date" }
        : nowDay - o.deliveredDay > c.returnWindowDays
          ? { eligible: false, reason: "window" }
          : { eligible: true, reason: "eligible" };
  const csvField = (v) =>
    /[",\r\n]/.test(String(v))
      ? '"' + String(v).replaceAll('"', '""') + '"'
      : String(v);
  const renderCSV = (rs) =>
    [
      "orderId,totalCents,currency",
      ...rs.map((r) =>
        [r.orderId, r.totalCents, r.currency].map(csvField).join(","),
      ),
    ].join("\r\n");
  const formatSummary = (rs) => ({
    orders: rs.length,
    totalCents: rs.reduce((n, r) => n + r.totalCents, 0),
    units: rs.reduce((n, r) => n + r.itemCount, 0),
  });
  const fulfillOrder = (o, s) => ({
    receipt: buildReceipt(o),
    stock: reserveInventory(s, o.cart),
  });
  const returnOrder = (o, context) => {
    const r = canReturn(o, context);
    return {
      ...r,
      refundCents: r.eligible ? priceOrder(o.cart, o.options).totalCents : 0,
      currency: c.currency,
    };
  };
  return {
    normalizeCart,
    priceOrder,
    buildReceipt,
    reserveInventory,
    canReturn,
    renderCSV,
    formatSummary,
    fulfillOrder,
    returnOrder,
  };
}
function evaluate(m, c) {
  const gold = oracle(c),
    flags = [],
    failures = {};
  for (const x of inputs()) {
    const order = {
        id: x.id,
        cart: x.cart,
        options: x.options,
        status: x.status,
        deliveredDay: x.deliveredDay,
      },
      context = { nowDay: x.deliveredDay + x.age };
    const receipt = gold.buildReceipt(order),
      receipts = [
        receipt,
        { ...receipt, orderId: 'extra,"\n', totalCents: 7, itemCount: 3 },
      ];
    for (const name of [
      "normalizeCart",
      "priceOrder",
      "buildReceipt",
      "renderCSV",
      "formatSummary",
      "reserveInventory",
      "canReturn",
      "fulfillOrder",
      "returnOrder",
    ]) {
      const args =
        name === "normalizeCart"
          ? [x.cart]
          : name === "priceOrder"
            ? [x.cart, x.options]
            : name === "buildReceipt"
              ? [order]
              : ["renderCSV", "formatSummary"].includes(name)
                ? [receipts]
                : name === "reserveInventory"
                  ? [x.stock, x.cart]
                  : name === "fulfillOrder"
                    ? [order, x.stock]
                    : [order, context];
      const goldArgs = structuredClone(args),
        actualArgs = structuredClone(args),
        before = structuredClone(actualArgs);
      let expected, error;
      try {
        expected = gold[name](...goldArgs);
      } catch (e) {
        error = { name: e.name, message: e.message };
      }
      try {
        if (error) assert.throws(() => m[name](...actualArgs), error);
        else assert.deepEqual(m[name](...actualArgs), expected);
        assert.deepEqual(actualArgs, before, "Inputs must remain unchanged");
        flags.push({ case: x.index, group: name, passed: true });
      } catch (e) {
        flags.push({ case: x.index, group: name, passed: false });
        const examples = failures[name] || (failures[name] = []);
        if (examples.length < 10)
          examples.push({
            case: x.index,
            input: x,
            expected: error ? { throws: error } : expected,
            error: e.message,
          });
      }
    }
  }
  const groups = Object.fromEntries(
    [...new Set(flags.map((f) => f.group))].map((name) => [
      name,
      {
        passed: flags.filter((f) => f.group === name && f.passed).length,
        total: iterations,
      },
    ]),
  );
  return {
    passed: flags.filter((f) => f.passed).length,
    total: flags.length,
    groups,
    flags,
    failures,
  };
}
if (process.argv.includes("--calibrate")) {
  let checked = 0,
    mutants = 0;
  for (let i = 0; i < 4; i++) {
    const c = fixture(i).final,
      ref = oracle(c),
      r = evaluate(ref, c);
    assert.equal(r.passed, r.total);
    checked += r.total;
    for (const name of Object.keys(ref)) {
      const broken = { ...ref, [name]: () => null };
      assert.ok(evaluate(broken, c).passed < r.total);
      mutants++;
    }
  }
  console.log(
    JSON.stringify({
      oracleChecks: checked,
      mutantsCaught: mutants,
      modelCalls: 0,
    }),
  );
  process.exit(0);
}
const data = JSON.parse(
  fs.readFileSync(
    path.join(workspace, "docs/benchmarks/2026-10-06-longitudinal.json"),
    "utf8",
  ),
);
assert.ok(
  data.completedAt && !data.preflight,
  "All primary collection must finish before stress evaluation",
);
const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "dip-longitudinal-stress-"),
);
const results = {
  protocol,
  primaryProtocolSources: data.protocol.sources,
  startedAt: new Date().toISOString(),
  pairs: [],
};
try {
  for (const pair of data.pairs) {
    const row = { index: pair.index, arms: {} };
    results.pairs.push(row);
    for (const arm of ["without", "with"]) {
      const root = path.join(sandbox, String(pair.index), arm);
      fs.mkdirSync(root, { recursive: true });
      for (const [relative, file] of Object.entries(
        pair.arms[arm].stages.audit.artifacts,
      )) {
        const target = path.resolve(root, relative);
        assert.ok(
          !path.isAbsolute(relative) && target.startsWith(root + path.sep),
          "Stress artifact path escaped",
        );
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.text);
      }
      const m = {};
      const loadErrors = [];
      for (const file of [
        "cart.mjs",
        "summary.mjs",
        "receipt.mjs",
        "inventory.mjs",
        "returns.mjs",
        "pipeline.mjs",
      ])
        try {
          Object.assign(
            m,
            await import(pathToFileURL(path.join(root, file)).href),
          );
        } catch (e) {
          loadErrors.push({
            file,
            error: e.message.replaceAll(root, "<project>"),
          });
        }
      row.arms[arm] = { ...evaluate(m, fixture(pair.index).final), loadErrors };
    }
  }
  results.completedAt = new Date().toISOString();
  results.summary = Object.fromEntries(
    ["without", "with"].map((arm) => [
      arm,
      {
        passed: results.pairs.reduce((n, p) => n + p.arms[arm].passed, 0),
        total: results.pairs.reduce((n, p) => n + p.arms[arm].total, 0),
        allCaseProjects: results.pairs.filter(
          (p) => p.arms[arm].passed === p.arms[arm].total,
        ).length,
      },
    ]),
  );
  fs.writeFileSync(
    path.join(workspace, "docs/benchmarks/2026-10-06-longitudinal-stress.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results.summary));
} finally {
  const target = fs.realpathSync(sandbox),
    temp = fs.realpathSync(os.tmpdir());
  assert.ok(
    target.startsWith(temp + path.sep) &&
      path.basename(target).startsWith("dip-longitudinal-stress-"),
  );
  fs.rmSync(target, { recursive: true, force: true });
}
