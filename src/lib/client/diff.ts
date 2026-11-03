export type DiffLine = { kind: "same" | "add" | "del"; text: string; n?: number };

/** Line diff (LCS). Returns only changed hunks with `ctx` lines of context. */
export function lineDiff(a: string, b: string, ctx = 2): DiffLine[][] {
  const A = a.split("\n"), B = b.split("\n");
  // trim common prefix/suffix to keep the table small
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
  if (a2.length * b2.length > 400_000) {
    return [[...a2.map((t) => ({ kind: "del" as const, text: t })), ...b2.map((t, i) => ({ kind: "add" as const, text: t, n: pre + i + 1 }))]];
  }
  const m = a2.length, n = b2.length;
  const L: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a2[i] === b2[j]) { mid.push({ kind: "same", text: a2[i], n: pre + j + 1 }); i++; j++; }
    else if (j < n && (i >= m || L[i][j + 1] >= L[i + 1][j])) { mid.push({ kind: "add", text: b2[j], n: pre + j + 1 }); j++; }
    else { mid.push({ kind: "del", text: a2[i] }); i++; }
  }
  const all: DiffLine[] = [
    ...A.slice(Math.max(0, pre - ctx), pre).map((t, k) => ({ kind: "same" as const, text: t, n: Math.max(0, pre - ctx) + k + 1 })),
    ...mid,
    ...B.slice(B.length - suf, B.length - suf + ctx).map((t, k) => ({ kind: "same" as const, text: t, n: B.length - suf + k + 1 })),
  ];
  // split into hunks around changes
  const hunks: DiffLine[][] = [];
  let cur: DiffLine[] = [];
  let lastChange = -999;
  all.forEach((d, k) => {
    if (d.kind !== "same") lastChange = k;
    const nearNext = all.slice(k, k + ctx + 1).some((x) => x.kind !== "same");
    if (d.kind !== "same" || k - lastChange <= ctx || nearNext) cur.push(d);
    else if (cur.length) { hunks.push(cur); cur = []; }
  });
  if (cur.length) hunks.push(cur);
  return hunks;
}
