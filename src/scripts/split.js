// tiptally — pure split-math engine. No DOM, no side effects.
// All money is handled in integer CENTS to avoid float drift.

/**
 * Convert a decimal currency amount (e.g. 123.45) to integer cents.
 * Rounds to nearest cent to absorb float noise.
 */
export function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Format integer cents as a fixed 2-decimal string, e.g. 12345 -> "123.45" */
export function centsToStr(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  // Group thousands in the whole part.
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}.${frac}`;
}

/**
 * Largest-remainder apportionment.
 * Given a total (integer cents) and an array of non-negative weights,
 * return integer cents per index that sum EXACTLY to total.
 * Ties in remainder are broken by larger raw weight, then lower index —
 * deterministic so the sheet is reproducible.
 */
export function largestRemainder(totalCents, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);

  if (sum <= 0) {
    // No basis to divide on: spread evenly, largest-remainder on equal shares.
    return largestRemainder(totalCents, new Array(n).fill(1));
  }

  const raw = weights.map((w) => (totalCents * w) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let distributed = floors.reduce((a, b) => a + b, 0);
  let remainder = totalCents - distributed; // whole cents still to hand out (can be negative)

  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x), weight: weights[i] }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.i - b.i;
    });

  const result = floors.slice();
  if (remainder > 0) {
    for (let k = 0; k < remainder; k++) {
      result[order[k % n].i] += 1;
    }
  } else if (remainder < 0) {
    // Rare (negative pool / rounding): claw back from smallest remainders.
    const revOrder = order.slice().reverse();
    for (let k = 0; k < -remainder; k++) {
      result[revOrder[k % n].i] -= 1;
    }
  }
  return result;
}

const METHOD_LABELS = {
  weighted: 'Weighted role × hours',
  hours: 'By hours',
  equal: 'Equal split',
  sales: 'By individual sales',
};

/**
 * Compute the basis (relative weight) each person contributes, per method.
 * Returns array of numbers (any non-negative scale).
 */
function computeBasis(people, method) {
  switch (method) {
    case 'hours':
      return people.map((p) => Math.max(0, p.hours || 0));
    case 'equal':
      return people.map(() => 1);
    case 'sales':
      return people.map((p) => Math.max(0, p.sales || 0));
    case 'weighted':
    default:
      return people.map((p) => Math.max(0, (p.weight || 0) * (p.hours || 0)));
  }
}

/**
 * Full split calculation.
 *
 * input = {
 *   poolCash, poolCard      : decimal currency amounts (numbers)
 *   method                  : 'weighted' | 'hours' | 'equal' | 'sales'
 *   tipOuts                 : [{ label, pct }]  percent off the top, e.g. 3 = 3%
 *   people                  : [{ id, name, hours, weight, role, sales }]
 * }
 *
 * Returns a structured result with everything the UI needs, all in cents.
 */
export function computeSplit(input) {
  const poolCents = toCents(input.poolCash || 0) + toCents(input.poolCard || 0);
  const cashCents = toCents(input.poolCash || 0);
  const cardCents = toCents(input.poolCard || 0);
  const method = input.method || 'weighted';
  const people = Array.isArray(input.people) ? input.people : [];

  // 1. Tip-outs come off the top, as a percentage of the ORIGINAL pool.
  const tipOuts = (input.tipOuts || [])
    .map((t) => ({
      label: (t.label || '').trim() || 'Tip-out',
      pct: Math.max(0, Number(t.pct) || 0),
    }))
    .filter((t) => t.pct > 0);

  const totalTipOutPct = tipOuts.reduce((a, t) => a + t.pct, 0);
  // Apportion the tip-out cents with largest-remainder so they're exact too.
  const rawTipOutCents = Math.round((poolCents * totalTipOutPct) / 100);
  const tipOutAlloc = largestRemainder(
    Math.min(rawTipOutCents, poolCents),
    tipOuts.map((t) => t.pct)
  );
  const tipOutRows = tipOuts.map((t, i) => ({
    label: t.label,
    pct: t.pct,
    cents: tipOutAlloc[i] || 0,
  }));
  const tipOutTotalCents = tipOutRows.reduce((a, r) => a + r.cents, 0);

  // 2. Remaining distributable pool.
  const distributableCents = poolCents - tipOutTotalCents;

  // 3. Basis per person, then largest-remainder apportionment.
  const basis = computeBasis(people, method);
  const basisSum = basis.reduce((a, b) => a + b, 0);
  const shares = largestRemainder(distributableCents, basis);

  const rows = people.map((p, i) => {
    const share = shares[i] || 0;
    const b = basis[i] || 0;
    const pctOfPool = distributableCents > 0 ? (share / distributableCents) * 100 : 0;
    return {
      id: p.id,
      name: (p.name || '').trim() || 'Unnamed',
      role: p.role || '',
      hours: p.hours || 0,
      weight: p.weight || 0,
      sales: p.sales || 0,
      basis: b,
      basisSum,
      share, // cents
      pct: pctOfPool,
      formula: buildFormula(p, method, b, basisSum, distributableCents),
      why: buildWhy(p, method, b, basisSum),
    };
  });

  const distributedCents = rows.reduce((a, r) => a + r.share, 0);
  const reconciled = distributedCents + tipOutTotalCents === poolCents;

  return {
    method,
    methodLabel: METHOD_LABELS[method] || method,
    poolCents,
    cashCents,
    cardCents,
    tipOutRows,
    tipOutTotalCents,
    distributableCents,
    rows,
    distributedCents,
    reconciled,
    // leftover cents that largest-remainder handed out beyond the exact floors
    penniesReconciled: Math.abs(
      distributableCents -
        (basisSum > 0
          ? rows.reduce((a, r) => a + Math.floor((distributableCents * r.basis) / basisSum), 0)
          : distributableCents)
    ),
  };
}

function buildFormula(p, method, basis, basisSum, distributableCents) {
  const pool = centsToStr(distributableCents);
  const name = (p.name || '').trim() || 'Unnamed';
  if (basisSum <= 0) {
    return `${name}: no basis to divide on → even split of ${pool}`;
  }
  const b = round2(basis);
  const s = round2(basisSum);
  switch (method) {
    case 'hours':
      return `${name}: ${round2(p.hours || 0)} hrs ÷ ${s} total hrs × ${pool}`;
    case 'equal':
      return `${name}: 1 share ÷ ${s} people × ${pool}`;
    case 'sales':
      return `${name}: sales ${round2(p.sales || 0)} ÷ ${s} total sales × ${pool}`;
    case 'weighted':
    default:
      return `${name}: (${round2(p.weight || 0)} weight × ${round2(
        p.hours || 0
      )} hrs = ${b}) ÷ ${s} × ${pool}`;
  }
}

function buildWhy(p, method, basis, basisSum) {
  const name = (p.name || '').trim() || 'This person';
  if (basisSum <= 0) {
    return `There’s nothing to divide on yet, so everyone is treated equally.`;
  }
  const pct = round1((basis / basisSum) * 100);
  switch (method) {
    case 'hours':
      return `${name} worked ${round2(p.hours || 0)} hours, which is ${pct}% of all hours on shift.`;
    case 'equal':
      return `Everyone gets the same share regardless of hours or role — ${pct}% each.`;
    case 'sales':
      return `${name} rang up ${round2(
        p.sales || 0
      )} in sales, which is ${pct}% of the team total.`;
    case 'weighted':
    default:
      return `${name}’s role weight (${round2(
        p.weight || 0
      )}) times ${round2(p.hours || 0)} hours gives ${pct}% of the weighted total.`;
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export { METHOD_LABELS };
