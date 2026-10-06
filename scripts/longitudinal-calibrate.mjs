import { fixture, cases } from "./longitudinal-fixtures.mjs";
import assert from "node:assert/strict";
function reference(c) {
  const normalizeCart = (cart) => {
    const out = [];
    for (const x of cart) {
      if (
        !x ||
        typeof x.sku !== "string" ||
        !x.sku.trim() ||
        !Number.isInteger(x.quantity) ||
        x.quantity <= 0 ||
        !Number.isInteger(x.unitPriceCents) ||
        x.unitPriceCents < 0
      )
        continue;
      const sku = x.sku.trim();
      const found = out.find(
        (l) => l.sku === sku && l.unitPriceCents === x.unitPriceCents,
      );
      if (found) found.quantity += x.quantity;
      else
        out.push({
          sku,
          quantity: x.quantity,
          unitPriceCents: x.unitPriceCents,
        });
    }
    return out;
  };
  const priceOrder = (cart, options = {}) => {
    const subtotalCents = normalizeCart(cart).reduce(
      (n, l) => n + l.quantity * l.unitPriceCents,
      0,
    );
    const discountCents = Math.round(
      (subtotalCents *
        Math.max(0, Math.min(c.couponCapPercent, options.couponPercent || 0))) /
        100,
    );
    const taxCents = Math.round(
      ((c.taxBase === "subtotal"
        ? subtotalCents
        : subtotalCents - discountCents) *
        c.taxRatePercent) /
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
  };
  const buildReceipt = (order) => ({
    orderId: order.id,
    ...priceOrder(order.cart, order.options),
    itemCount: normalizeCart(order.cart).reduce((n, l) => n + l.quantity, 0),
    currency: c.currency,
  });
  const field = (x) => {
    const s = String(x);
    return /[,"\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const renderCSV = (receipts) =>
    [
      "orderId,totalCents,currency",
      ...receipts.map((r) =>
        [r.orderId, r.totalCents, r.currency].map(field).join(","),
      ),
    ].join(c.csvNewline === "CRLF" ? "\r\n" : "\n");
  const reserveInventory = (stock, cart) => {
    const needed = new Map();
    for (const l of normalizeCart(cart))
      needed.set(l.sku, (needed.get(l.sku) || 0) + l.quantity);
    for (const [sku, q] of needed)
      if ((stock[sku] || 0) < q) throw new RangeError("insufficient stock");
    const out = { ...stock };
    for (const [sku, q] of needed) out[sku] = (out[sku] || 0) - q;
    return out;
  };
  const canReturn = (order, { nowDay }) => {
    if (order.status !== "delivered")
      return { eligible: false, reason: "status" };
    if (
      !Number.isInteger(order.deliveredDay) ||
      order.deliveredDay < 0 ||
      !Number.isInteger(nowDay) ||
      nowDay < 0 ||
      nowDay < order.deliveredDay
    )
      return { eligible: false, reason: "date" };
    if (nowDay - order.deliveredDay > c.returnWindowDays)
      return { eligible: false, reason: "window" };
    return { eligible: true, reason: "eligible" };
  };
  const fulfillOrder = (order, stock) => ({
    receipt: buildReceipt(order),
    stock: reserveInventory(stock, order.cart),
  });
  const returnOrder = (order, context) => {
    const r = canReturn(order, context);
    return {
      ...r,
      refundCents: r.eligible
        ? priceOrder(order.cart, order.options).totalCents
        : 0,
      currency: c.currency,
    };
  };
  const formatSummary = (receipts) => ({
    orders: receipts.length,
    totalCents: receipts.reduce((n, r) => n + r.totalCents, 0),
    units: receipts.reduce((n, r) => n + r.itemCount, 0),
  });
  return {
    normalizeCart,
    priceOrder,
    buildReceipt,
    renderCSV,
    reserveInventory,
    canReturn,
    fulfillOrder,
    returnOrder,
    formatSummary,
  };
}
let passed = 0,
  mutantsCaught = 0;
for (let i = 0; i < 4; i++)
  for (const phase of ["initial", "revised", "final"]) {
    const c = fixture(i)[phase],
      r = reference(c);
    for (const test of cases(r, c)) {
      test.fn();
      passed++;
    }
    const mutants = [
      { ...r, priceOrder: () => ({}) },
      { ...r, renderCSV: () => "" },
      { ...r, reserveInventory: (s) => s },
      { ...r, canReturn: () => ({ eligible: true, reason: "eligible" }) },
      { ...r, normalizeCart: (x) => x },
    ];
    for (const mutant of mutants) {
      const failures = cases(mutant, c).filter((test) => {
        try {
          test.fn();
          return false;
        } catch {
          return true;
        }
      });
      assert.ok(failures.length > 0, "Mutation must be detected");
      mutantsCaught++;
    }
  }
console.log(
  JSON.stringify({
    referenceChecksPassed: passed,
    deliberateMutantsCaught: mutantsCaught,
    modelCalls: 0,
  }),
);
