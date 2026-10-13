/**
 * AnomalyDetector - Identifies anomalous log rates, rare patterns, and latency spikes.
 * Enhanced with: adaptive z-score, MAD-based detection, entity concentration, message length outliers.
 */

/**
 * Compute median of a sorted array
 */
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Compute MAD (Median Absolute Deviation) — robust alternative to standard deviation
 */
function mad(arr) {
  const med = median(arr);
  return median(arr.map(v => Math.abs(v - med)));
}

/**
 * Adaptive z-score threshold based on data distribution.
 * For small datasets (<30), use a higher threshold to avoid false positives.
 */
function adaptiveThreshold(dataSize) {
  if (dataSize < 10) return 3.0;  // very conservative
  if (dataSize < 30) return 2.5;  // conservative
  if (dataSize < 100) return 2.0; // standard
  return 1.8; // more sensitive for large datasets
}

/**
 * Analyzes parsed logs and patterns to flag anomalous behavior.
 * Returns an array of anomalies sorted by score descending.
 */
function detectAnomalies(parsedLogs, patterns) {
  const anomalies = [];
  let anomalyIdCounter = 1;

  if (!parsedLogs || parsedLogs.length === 0) return anomalies;

  const totalLogs = parsedLogs.length;

  // 1. Rare Pattern Detection with adaptive threshold
  const rareThreshold = totalLogs < 100 ? 3.0 : totalLogs < 1000 ? 2.0 : 1.5;
  patterns.forEach(pattern => {
    const percentage = (pattern.count / totalLogs) * 100;
    const isRare = (pattern.level !== 'INFO' && percentage < rareThreshold) || (pattern.level === 'INFO' && percentage < rareThreshold * 0.35);

    if (isRare && pattern.count <= Math.max(10, totalLogs * 0.005)) {
      anomalies.push({
        id: `anom_${anomalyIdCounter++}`,
        type: 'rare_pattern',
        title: `Rare Pattern Detected: ${pattern.level.toUpperCase()}`,
        description: `Pattern "${pattern.template.substring(0, 80)}${pattern.template.length > 80 ? '...' : ''}" occurred only ${pattern.count} time(s) (${percentage.toFixed(2)}% of logs).`,
        severity: pattern.level === 'ERROR' ? 'high' : pattern.level === 'WARN' ? 'medium' : 'low',
        logs: pattern.logs,
        score: Math.min(100, Math.round(90 - percentage * 10))
      });
    }
  });

  // 2. Latency Outlier Detection using MAD (robust to extreme outliers)
  const durationLogs = parsedLogs.filter(log =>
    log.metrics && (typeof log.metrics.durationMs === 'number' || typeof log.metrics.duration === 'number')
  );
  if (durationLogs.length >= 5) {
    const durations = durationLogs.map(log => log.metrics.durationMs || log.metrics.duration);
    const med = median(durations);
    const madVal = mad(durations);
    const threshold = adaptiveThreshold(durations.length);
    // MAD-based outlier: |x - median| / (1.4826 * MAD) > threshold
    // 1.4826 converts MAD to estimate of standard deviation for normal distribution
    const madScale = madVal > 0 ? 1.4826 * madVal : 1;

    durationLogs.forEach(log => {
      const val = log.metrics.durationMs || log.metrics.duration;
      const deviation = Math.abs(val - med) / madScale;
      if (deviation > threshold && val > 500) {
        anomalies.push({
          id: `anom_${anomalyIdCounter++}`,
          type: 'latency_outlier',
          title: 'Extreme Latency Outlier',
          description: `Log execution time took ${val.toFixed(1)}ms, which is ${deviation.toFixed(1)}σ above the median ${med.toFixed(1)}ms.`,
          severity: deviation > 4 ? 'high' : 'medium',
          logs: [log.index],
          score: Math.min(100, Math.round(50 + deviation * 8))
        });
      }
    });
  }

  // 3. Log Volume / Severity Spike Detection over time
  const timestamps = parsedLogs
    .map(log => new Date(log.timestamp).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length >= 20) {
    const timeSpan = timestamps[timestamps.length - 1] - timestamps[0];
    let bucketSize = 60 * 1000;
    if (timeSpan > 24 * 60 * 60 * 1000) bucketSize = 60 * 60 * 1000;
    else if (timeSpan > 2 * 60 * 60 * 1000) bucketSize = 5 * 60 * 1000;

    const buckets = {};
    parsedLogs.forEach(log => {
      const time = new Date(log.timestamp).getTime();
      if (isNaN(time)) return;
      const bucketId = Math.floor(time / bucketSize) * bucketSize;
      if (!buckets[bucketId]) buckets[bucketId] = { total: 0, errors: 0, warns: 0, logs: [] };
      buckets[bucketId].total++;
      if (log.level === 'ERROR') buckets[bucketId].errors++;
      else if (log.level === 'WARN') buckets[bucketId].warns++;
      buckets[bucketId].logs.push(log.index);
    });

    const bucketKeys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const totals = bucketKeys.map(k => buckets[k].total);
    const errRatios = bucketKeys.map(k => buckets[k].errors / Math.max(1, buckets[k].total));

    // Adaptive threshold for volume spikes
    const volThreshold = adaptiveThreshold(totals.length);
    const medVol = median(totals);
    const madVol = mad(totals);
    const volScale = madVol > 0 ? 1.4826 * madVol : 1;

    bucketKeys.forEach((k, i) => {
      const b = buckets[k];
      const timeStr = new Date(k).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Volume spike using MAD
      const volDeviation = Math.abs(b.total - medVol) / volScale;
      if (volDeviation > volThreshold && b.total > 5) {
        anomalies.push({
          id: `anom_${anomalyIdCounter++}`,
          type: 'volume_spike',
          title: `Traffic Volume Spike at ${timeStr}`,
          description: `Log output spiked to ${b.total} lines within this window, exceeding the median of ${medVol.toFixed(1)} lines by ${volDeviation.toFixed(1)}σ.`,
          severity: volDeviation > 4 ? 'high' : 'medium',
          logs: b.logs,
          score: Math.min(100, Math.round(60 + volDeviation * 10))
        });
      }

      // Severity spike with graduated thresholds
      const errorRatio = b.errors / Math.max(1, b.total);
      const warnRatio = b.warns / Math.max(1, b.total);
      if (errorRatio > 0.4 && b.total >= 3) {
        anomalies.push({
          id: `anom_${anomalyIdCounter++}`,
          type: 'severity_spike',
          title: `High Error Density Spike at ${timeStr}`,
          description: `${Math.round(errorRatio * 100)}% of log entries (${b.errors} out of ${b.total}) are errors in this time interval.`,
          severity: 'high',
          logs: b.logs,
          score: Math.round(50 + errorRatio * 50)
        });
      } else if (errorRatio > 0.2 && warnRatio > 0.1 && b.total >= 5) {
        anomalies.push({
          id: `anom_${anomalyIdCounter++}`,
          type: 'severity_spike',
          title: `Elevated Warning/Error Rate at ${timeStr}`,
          description: `${Math.round(errorRatio * 100)}% errors, ${Math.round(warnRatio * 100)}% warnings (${b.errors + b.warns} out of ${b.total}).`,
          severity: 'medium',
          logs: b.logs,
          score: Math.round(40 + errorRatio * 30 + warnRatio * 20)
        });
      }
    });
  }

  // 4. Entity concentration anomaly: single entity dominates
  const entityCounts = {};
  parsedLogs.forEach(log => {
    if (log.ids) {
      for (const [type, value] of Object.entries(log.ids)) {
        if (value && type !== 'host' && type !== 'process' && type !== 'pid') {
          const key = `${type}:${value}`;
          if (!entityCounts[key]) entityCounts[key] = { type, value, count: 0 };
          entityCounts[key].count++;
        }
      }
    }
  });

  for (const entity of Object.values(entityCounts)) {
    const ratio = entity.count / totalLogs;
    if (ratio > 0.5 && entity.count > 20) {
      anomalies.push({
        id: `anom_${anomalyIdCounter++}`,
        type: 'entity_concentration',
        title: `Single ${entity.type} Dominates: ${entity.value.substring(0, 40)}`,
        description: `Entity "${entity.value}" appears in ${Math.round(ratio * 100)}% of all logs (${entity.count}/${totalLogs}). Possible single-source flood or misconfigured component.`,
        severity: ratio > 0.8 ? 'high' : 'medium',
        logs: [],
        score: Math.min(100, Math.round(ratio * 100))
      });
    }
  }

  // 5. Message length outliers: unusually long or short messages
  const msgLengths = parsedLogs.map(log => (log.message || '').length).filter(l => l > 0);
  if (msgLengths.length >= 20) {
    const medLen = median(msgLengths);
    const madLen = mad(msgLengths);
    const lenScale = madLen > 0 ? 1.4826 * madLen : 1;
    const lenThreshold = adaptiveThreshold(msgLengths.length);

    parsedLogs.forEach(log => {
      const len = (log.message || '').length;
      if (len === 0) return;
      const deviation = Math.abs(len - medLen) / lenScale;
      if (deviation > lenThreshold && len > 1000) {
        anomalies.push({
          id: `anom_${anomalyIdCounter++}`,
          type: 'message_length_outlier',
          title: 'Unusually Long Log Message',
          description: `Message length is ${len} chars (${deviation.toFixed(1)}σ above median of ${medLen} chars). Possible payload dump or stack trace.`,
          severity: 'low',
          logs: [log.index],
          score: Math.min(60, Math.round(deviation * 10))
        });
      }
    });
  }

  return anomalies.sort((a, b) => b.score - a.score);
}

module.exports = {
  detectAnomalies
};
