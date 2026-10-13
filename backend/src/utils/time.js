function toEpochMs(ts) {
  if (ts == null) return NaN;
  const n = Number(ts);
  if (!isNaN(n) && n > 0) return n;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? NaN : d.getTime();
}

module.exports = { toEpochMs };
