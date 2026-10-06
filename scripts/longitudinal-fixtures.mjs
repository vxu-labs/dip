import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const instructions = `Work only in this repository/worktree. Do not read sibling worktrees, user settings, credentials, previous conversations or the evaluator. No network, dependency installation, extra agents or machine settings. Use Node.js built-ins and PowerShell without profiles. Ordinary Markdown plans, decisions and handoff notes are allowed. Keep future features deferred and cancelled features cancelled. Report actual code state, not just a plan. Do not commit or create branches yourself unless the integration prompt explicitly permits resolving an existing merge. Repository state is the only memory between these fresh conversations.`;
export const functions = [
  "normalizeCart",
  "priceOrder",
  "formatSummary",
  "buildReceipt",
  "renderCSV",
  "reserveInventory",
  "canReturn",
  "fulfillOrder",
  "returnOrder",
];
export const files = {
  "cart.mjs":
    "// Cart normalization and price calculation. Implement the requested exports here.\n",
  "summary.mjs": "// Summary adapter.\n",
  "receipt.mjs": "// Receipt and CSV adapters.\n",
  "inventory.mjs": "// Atomic reservation adapter.\n",
  "returns.mjs": "// Return eligibility policy.\n",
  "pipeline.mjs":
    "// Both pipeline workers edit this module. Preserve the other worker's exports.\n",
  "smoke.test.mjs": `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { normalizeCart } from './cart.mjs';\ntest('empty cart', () => assert.deepEqual(normalizeCart([]), []));\ntest('valid line', () => assert.deepEqual(normalizeCart([{sku:'a',quantity:2,unitPriceCents:101}]), [{sku:'a',quantity:2,unitPriceCents:101}]));\n`,
};
export function fixture(index) {
  const initial = {
    taxRatePercent: 10,
    couponCapPercent: 15,
    taxBase: "subtotal",
    discountRounding: "once_per_order",
    currency: "USD",
    csvNewline: "LF",
    returnWindowDays: 30,
    duplicatePolicy: "merge_same_sku_and_price_in_first_order",
    invalidPolicy: "drop",
    inventoryAtomic: true,
  };
  const revised = {
    ...initial,
    taxRatePercent: [7, 11, 17, 9][index],
    couponCapPercent: [20, 25, 30, 35][index],
    taxBase: "after_discount_excluding_shipping",
    returnWindowDays: [14, 21, 7, 10][index],
  };
  const final = {
    ...revised,
    currency: ["EUR", "GBP", "CAD", "ILS"][index],
    csvNewline: "CRLF",
    returnWindowDays: revised.returnWindowDays + 2,
  };
  const spec = `Build a local order-processing library with these exports in the indicated modules. normalizeCart(cart) in cart.mjs: accept an array of lines; keep lines whose sku is a nonempty trimmed string, quantity is a positive integer, and unitPriceCents is a nonnegative integer. Trim sku; drop invalid lines, including null. Combine quantities only for the same trimmed sku AND unit price, preserving first appearance. Return new {sku,quantity,unitPriceCents} objects, without modifying input. priceOrder(cart, options={}) in cart.mjs returns exactly {subtotalCents,discountCents,taxCents,shippingCents,totalCents}. subtotal is sum of normalized quantity*price. couponPercent defaults to 0; clamp it to [0,cap]. Round discount once with Math.round(subtotal*couponPercent/100). Round tax once with Math.round(taxBase*taxRate/100). shippingCents defaults to 0 and is added after tax. Assume finite numeric coupon and nonnegative integer shipping. buildReceipt(order) in receipt.mjs uses order={id,cart,options,status,deliveredDay}; return exactly {orderId:order.id,...priceOrder(order.cart,order.options),itemCount:sum of normalized quantities,currency}. renderCSV(receipts) in receipt.mjs returns a header orderId,totalCents,currency followed by rows; escape fields containing comma, quote or newline using CSV quoting and doubled quotes; no trailing newline; empty input returns just the header. reserveInventory(stock,cart) in inventory.mjs: stock is an object of nonnegative integer counts by sku, absent sku means 0; aggregate normalized quantities across prices, check ALL availability first; throw RangeError('insufficient stock') if any sku is insufficient; otherwise return a new stock object with counts subtracted. Never modify stock or cart, even on failure. canReturn(order,{nowDay}) in returns.mjs returns exactly {eligible,reason}. Check in order: status must equal 'delivered' else reason 'status'; deliveredDay and nowDay must be nonnegative integers with nowDay>=deliveredDay else reason 'date'; nowDay-deliveredDay must be <= returnWindowDays else reason 'window'; otherwise {eligible:true,reason:'eligible'}. fulfillOrder(order,stock) in pipeline.mjs returns exactly {receipt:buildReceipt(order),stock:reserveInventory(stock,order.cart)}. returnOrder(order,context) in pipeline.mjs returns exactly {...canReturn(order,context),refundCents:eligible?priceOrder(order.cart,order.options).totalCents:0,currency}. formatSummary(receipts) in summary.mjs returns exactly {orders:receipts.length,totalCents:sum of totalCents,units:sum of itemCount}. No input mutation anywhere. The policy is ${JSON.stringify(initial)}. MULTI_CURRENCY and LOYALTY_POINTS are separate FUTURE ideas, not part of this release.`;
  const reportShape = `Write REPORT_FILE as JSON with {"contract":{the ten current policy fields},"deferred":[feature identifiers still deferred],"cancelled":[cancelled identifiers],"completed":[implemented export names],"unresolved":[remaining requirements],"releaseReady":boolean}. Check actual code before asserting completion. Do not guess missing requirements.`;
  const prompts = {
    seed: `Create a plan for this project and start it. ${spec}\nImplement ONLY normalizeCart now; leave the other exports pending for other conversations. Preserve the project intent and the partial handoff using appropriate local mechanisms.`,
    revision: `Change request after the first implementation: the policy is now ${JSON.stringify(revised)}. This supersedes the earlier tax rate, coupon cap, tax base and return window. In particular tax is calculated AFTER discount and excludes shipping. Implement priceOrder now and preserve the revised contract for the pending adapters. Leave the remaining exports pending.`,
    detour: `A small side task: implement formatSummary(receipts) in summary.mjs according to the existing project contract, leaving all other pending implementation for later. Also, someday we should add FRAUD_SCORING. We have dropped LOYALTY_POINTS entirely, please treat it as cancelled rather than a future commitment. Keep MULTI_CURRENCY for the future.`,
    interrupted: `Continue with the receipt adapter. Implement buildReceipt and renderCSV in receipt.mjs using the latest project requirements, add useful local checks, and update the project handoff. Leave inventory, return policy and pipeline to their assigned future workers.`,
    workerA: `You are worker A in your isolated Git worktree. Another worker may be active on this same repository in a different worktree. Recover the latest requirements from repository state. Implement reserveInventory in inventory.mjs and fulfillOrder in pipeline.mjs. Preserve any other pipeline exports. Coordinate overlapping ownership using the available repository mechanisms; do not inspect the other worktree. Stay within this work; do not implement return eligibility/returnOrder or future features. Leave an accurate handoff. The harness will commit your changes after your turn.`,
    workerB: `You are worker B in your isolated Git worktree. Another worker may be active on this same repository in a different worktree. Recover the latest requirements from repository state. Implement canReturn in returns.mjs and returnOrder in pipeline.mjs. Preserve any other pipeline exports. Coordinate overlapping ownership using the available repository mechanisms; do not inspect the other worktree. Stay within this work; do not implement inventory reservation/fulfillOrder or future features. Leave an accurate handoff. The harness will commit your changes after your turn.`,
    integration: `You are a fresh integration conversation. Two independent worktree workers were committed to branches worker-a and worker-b. The harness attempted their merges; examine actual Git state and MERGE_HANDOFF.md. You may use Git to resolve the existing merge, commit the resolution and merge either still-unmerged worker branch. Do not rewrite history or discard either worker's requested functionality. Recover the latest requirements from repository records, repair conflicts and unfinished receipt work, integrate all current release exports, and run local checks. ${reportShape.replace("REPORT_FILE", "handoff.json")}`,
    finalRevision: `One final actual change request: currency is now '${final.currency}' for this release, CSV line endings must be CRLF with no trailing newline, and the return window is now ${final.returnWindowDays} days inclusive. These supersede previous values. All other latest requirements remain in force. Implement these changes, complete any still-pending release work, and check for regressions across the whole project. Future and cancelled features remain outside scope. Preserve an accurate final handoff.`,
    audit: `Independent fresh audit conversation. Do not edit product modules, plans or requirements. Recover the current contract, future ideas, cancellations and implemented scope from repository state. Run local checks and inspect actual code. ${reportShape.replace("REPORT_FILE", "quality.json")} You may create audit tests and quality.json, but do not repair code in this audit. State uncertainty or missing work honestly.`,
  };
  return {
    index,
    initial,
    revised,
    final,
    prompts,
    deferred: ["MULTI_CURRENCY", "FRAUD_SCORING"],
    cancelled: ["LOYALTY_POINTS"],
  };
}

function expectedPrice(cart, options, contract) {
  const subtotalCents = cart.reduce(
    (n, l) => n + l.quantity * l.unitPriceCents,
    0,
  );
  const discountCents = Math.round(
    (subtotalCents *
      Math.min(
        contract.couponCapPercent,
        Math.max(0, options.couponPercent || 0),
      )) /
      100,
  );
  const taxCents = Math.round(
    ((contract.taxBase === "subtotal"
      ? subtotalCents
      : subtotalCents - discountCents) *
      contract.taxRatePercent) /
      100,
  );
  const shippingCents = options.shippingCents || 0;
  return {
    subtotalCents,
    discountCents,
    taxCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + taxCents + shippingCents,
  };
}
export function cases(m, c) {
  const line = { sku: "a", quantity: 2, unitPriceCents: 101 };
  const order = {
    id: "order-1",
    cart: [line],
    options: { couponPercent: 99, shippingCents: 13 },
    status: "delivered",
    deliveredDay: 5,
  };
  const price = expectedPrice([line], order.options, c);
  const receipt = {
    orderId: "order-1",
    ...price,
    itemCount: 2,
    currency: c.currency,
  };
  const tests = [];
  const add = (name, fn, group) => tests.push({ name, fn, group });
  add("empty cart", () => assert.deepEqual(m.normalizeCart([]), []), "core");
  add(
    "trim and drop invalid",
    () =>
      assert.deepEqual(
        m.normalizeCart([
          null,
          { sku: " a ", quantity: 1, unitPriceCents: 0 },
          { sku: " ", quantity: 1, unitPriceCents: 2 },
          { sku: "b", quantity: 0, unitPriceCents: 3 },
          { sku: "c", quantity: 1.2, unitPriceCents: 3 },
          { sku: "d", quantity: 1, unitPriceCents: -1 },
        ]),
        [{ sku: "a", quantity: 1, unitPriceCents: 0 }],
      ),
    "core",
  );
  add(
    "stable duplicate consolidation",
    () =>
      assert.deepEqual(
        m.normalizeCart([
          line,
          { sku: "b", quantity: 1, unitPriceCents: 7 },
          { sku: " a ", quantity: 3, unitPriceCents: 101 },
          { sku: "a", quantity: 1, unitPriceCents: 102 },
        ]),
        [
          { sku: "a", quantity: 5, unitPriceCents: 101 },
          { sku: "b", quantity: 1, unitPriceCents: 7 },
          { sku: "a", quantity: 1, unitPriceCents: 102 },
        ],
      ),
    "core",
  );
  add(
    "normalization immutable",
    () => {
      const x = structuredClone([line]);
      const before = JSON.stringify(x);
      const out = m.normalizeCart(x);
      assert.equal(JSON.stringify(x), before);
      assert.notEqual(out[0], x[0]);
    },
    "core",
  );
  add(
    "default pricing",
    () => assert.deepEqual(m.priceOrder([line]), expectedPrice([line], {}, c)),
    "pricing",
  );
  add(
    "coupon cap and revised tax",
    () => assert.deepEqual(m.priceOrder([line], order.options), price),
    "pricing",
  );
  add(
    "negative coupon",
    () =>
      assert.deepEqual(
        m.priceOrder([line], { couponPercent: -9 }),
        expectedPrice([line], { couponPercent: -9 }, c),
      ),
    "pricing",
  );
  add(
    "discount rounded once",
    () => {
      const x = [
        { sku: "x", quantity: 1, unitPriceCents: 3 },
        { sku: "y", quantity: 1, unitPriceCents: 3 },
      ];
      assert.deepEqual(
        m.priceOrder(x, { couponPercent: 10 }),
        expectedPrice(x, { couponPercent: 10 }, c),
      );
    },
    "pricing",
  );
  add(
    "shipping excluded from tax",
    () =>
      assert.deepEqual(
        m.priceOrder([], { shippingCents: 999 }),
        expectedPrice([], { shippingCents: 999 }, c),
      ),
    "pricing",
  );
  add(
    "receipt exact fields and policy",
    () => assert.deepEqual(m.buildReceipt(order), receipt),
    "receipt",
  );
  add(
    "receipt immutable",
    () => {
      const x = structuredClone(order),
        before = JSON.stringify(x);
      m.buildReceipt(x);
      assert.equal(JSON.stringify(x), before);
    },
    "receipt",
  );
  add(
    "csv empty header",
    () => assert.equal(m.renderCSV([]), "orderId,totalCents,currency"),
    "receipt",
  );
  add(
    "csv latest newline and no trailing newline",
    () =>
      assert.equal(
        m.renderCSV([receipt, { ...receipt, orderId: "two" }]),
        `orderId,totalCents,currency${c.csvNewline === "CRLF" ? "\r\n" : "\n"}order-1,${price.totalCents},${c.currency}${c.csvNewline === "CRLF" ? "\r\n" : "\n"}two,${price.totalCents},${c.currency}`,
      ),
    "receipt",
  );
  add(
    "csv quote escaping",
    () =>
      assert.equal(
        m.renderCSV([{ ...receipt, orderId: 'a,"b"\nc' }]),
        `orderId,totalCents,currency${c.csvNewline === "CRLF" ? "\r\n" : "\n"}"a,""b""\nc",${price.totalCents},${c.currency}`,
      ),
    "receipt",
  );
  add(
    "inventory success exact",
    () =>
      assert.deepEqual(m.reserveInventory({ a: 3, b: 9 }, [line]), {
        a: 1,
        b: 9,
      }),
    "inventory",
  );
  add(
    "inventory aggregates across prices",
    () =>
      assert.throws(
        () =>
          m.reserveInventory({ a: 2 }, [
            line,
            { sku: "a", quantity: 1, unitPriceCents: 77 },
          ]),
        { name: "RangeError", message: "insufficient stock" },
      ),
    "inventory",
  );
  add(
    "inventory atomic failure",
    () => {
      const stock = { a: 5, b: 0 };
      assert.throws(
        () =>
          m.reserveInventory(stock, [
            line,
            { sku: "b", quantity: 1, unitPriceCents: 1 },
          ]),
        RangeError,
      );
      assert.deepEqual(stock, { a: 5, b: 0 });
    },
    "inventory",
  );
  add(
    "inventory absent and zero price",
    () =>
      assert.throws(
        () =>
          m.reserveInventory({}, [
            { sku: "free", quantity: 1, unitPriceCents: 0 },
          ]),
        RangeError,
      ),
    "inventory",
  );
  add(
    "inventory immutable success",
    () => {
      const stock = { a: 3 },
        cart = structuredClone([line]);
      m.reserveInventory(stock, cart);
      assert.deepEqual(stock, { a: 3 });
      assert.deepEqual(cart, [line]);
    },
    "inventory",
  );
  add(
    "return inclusive boundary",
    () =>
      assert.deepEqual(m.canReturn(order, { nowDay: 5 + c.returnWindowDays }), {
        eligible: true,
        reason: "eligible",
      }),
    "returns",
  );
  add(
    "return expired",
    () =>
      assert.deepEqual(m.canReturn(order, { nowDay: 6 + c.returnWindowDays }), {
        eligible: false,
        reason: "window",
      }),
    "returns",
  );
  add(
    "return status precedence",
    () =>
      assert.deepEqual(
        m.canReturn(
          { ...order, status: "pending", deliveredDay: -1 },
          { nowDay: 99 },
        ),
        { eligible: false, reason: "status" },
      ),
    "returns",
  );
  add(
    "return future date",
    () =>
      assert.deepEqual(m.canReturn(order, { nowDay: 4 }), {
        eligible: false,
        reason: "date",
      }),
    "returns",
  );
  add(
    "return invalid integer date",
    () =>
      assert.deepEqual(
        m.canReturn({ ...order, deliveredDay: 1.5 }, { nowDay: 6 }),
        { eligible: false, reason: "date" },
      ),
    "returns",
  );
  add(
    "fulfill integration",
    () =>
      assert.deepEqual(m.fulfillOrder(order, { a: 3, b: 1 }), {
        receipt,
        stock: { a: 1, b: 1 },
      }),
    "pipeline",
  );
  add(
    "fulfill atomic failure",
    () => {
      const stock = { a: 1 };
      assert.throws(() => m.fulfillOrder(order, stock), RangeError);
      assert.deepEqual(stock, { a: 1 });
    },
    "pipeline",
  );
  add(
    "return refund revised total and currency",
    () =>
      assert.deepEqual(m.returnOrder(order, { nowDay: 6 }), {
        eligible: true,
        reason: "eligible",
        refundCents: price.totalCents,
        currency: c.currency,
      }),
    "pipeline",
  );
  add(
    "return denied zero refund",
    () =>
      assert.deepEqual(
        m.returnOrder(order, { nowDay: 6 + c.returnWindowDays }),
        {
          eligible: false,
          reason: "window",
          refundCents: 0,
          currency: c.currency,
        },
      ),
    "pipeline",
  );
  add(
    "summary aggregate",
    () =>
      assert.deepEqual(
        m.formatSummary([receipt, { ...receipt, totalCents: 1, itemCount: 4 }]),
        { orders: 2, totalCents: price.totalCents + 1, units: 6 },
      ),
    "summary",
  );
  add(
    "summary empty",
    () =>
      assert.deepEqual(m.formatSummary([]), {
        orders: 0,
        totalCents: 0,
        units: 0,
      }),
    "summary",
  );
  return tests;
}
export async function score(
  root,
  index,
  { stage = "final", reportFile = null } = {},
) {
  const f = fixture(index),
    c = ["seed"].includes(stage)
      ? f.initial
      : ["final", "audit"].includes(stage)
        ? f.final
        : f.revised;
  const m = {},
    loadErrors = [];
  for (const file of [
    "cart.mjs",
    "summary.mjs",
    "receipt.mjs",
    "inventory.mjs",
    "returns.mjs",
    "pipeline.mjs",
  ]) {
    try {
      Object.assign(
        m,
        await import(
          pathToFileURL(path.join(root, file)).href + "?score=" + Date.now()
        ),
      );
    } catch (e) {
      loadErrors.push({ file, error: e.message });
    }
  }
  const checks = cases(m, c).map(({ name, fn, group }) => {
    try {
      fn();
      return { name, group, passed: true };
    } catch (e) {
      return { name, group, passed: false, error: e.message };
    }
  });
  let report = null;
  try {
    report = JSON.parse(
      fs.readFileSync(path.join(root, reportFile || "quality.json"), "utf8"),
    );
  } catch {}
  const memory = Object.entries(c).map(([key, value]) => ({
    name: key,
    passed: report?.contract?.[key] === value,
  }));
  for (const id of f.deferred)
    memory.push({
      name: "deferred:" + id,
      passed: Array.isArray(report?.deferred) && report.deferred.includes(id),
    });
  memory.push({
    name: "cancelled:LOYALTY_POINTS",
    passed:
      Array.isArray(report?.cancelled) &&
      report.cancelled.includes("LOYALTY_POINTS") &&
      !(
        Array.isArray(report?.deferred) &&
        report.deferred.includes("LOYALTY_POINTS")
      ),
  });
  const availability = functions.map((name) => ({
    name,
    present: typeof m[name] === "function",
  }));
  const groups = {
    normalizeCart: "core",
    priceOrder: "pricing",
    formatSummary: "summary",
    buildReceipt: "receipt",
    renderCSV: "receipt",
    reserveInventory: "inventory",
    canReturn: "returns",
    fulfillOrder: "pipeline",
    returnOrder: "pipeline",
  };
  const claims = (
    Array.isArray(report?.completed) ? report.completed : []
  ).filter((x) => functions.includes(x));
  const unsupportedClaims = claims.filter((name) =>
    checks.filter((x) => x.group === groups[name]).some((x) => !x.passed),
  );
  const passed = checks.filter((x) => x.passed).length;
  return {
    checks,
    passed,
    total: checks.length,
    allPassed: passed === checks.length,
    memory,
    memoryPassed: memory.filter((x) => x.passed).length,
    memoryTotal: memory.length,
    availability,
    report,
    loadErrors,
    unsupportedClaims,
    releaseFalsePositive:
      report?.releaseReady === true && passed < checks.length,
    completeReport:
      !!report &&
      Array.isArray(report.completed) &&
      functions.every((x) => report.completed.includes(x)) &&
      Array.isArray(report.unresolved) &&
      report.unresolved.length === 0 &&
      report.releaseReady === true,
  };
}
