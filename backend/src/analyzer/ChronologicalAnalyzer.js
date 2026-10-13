/**
 * ChronologicalAnalyzer - Temporal analysis and time-series insights
 * Provides: timeline bucketing, temporal patterns, time-based anomalies
 */

/**
 * Buckets logs by time interval
 * Returns timeline with frequency distribution
 */
function generateTimeline(parsedLogs, bucketIntervalMinutes = 5) {
  if (parsedLogs.length === 0) {
    return {
      timeline: [],
      stats: { totalBuckets: 0, minTimestamp: null, maxTimestamp: null }
    };
  }

  // Find min/max timestamps (use canonicalized timestampEpochMs when available)
  const timestamps = parsedLogs
    .map(log => (log.timestampEpochMs && !isNaN(log.timestampEpochMs)) ? log.timestampEpochMs : new Date(log.timestamp).getTime())
    .filter(ts => !isNaN(ts))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) {
    return { timeline: [], stats: { totalBuckets: 0 } };
  }

  const minTs = timestamps[0];
  const maxTs = timestamps[timestamps.length - 1];
  const bucketMs = bucketIntervalMinutes * 60 * 1000;
  const bucketCount = Math.max(1, Math.ceil((maxTs - minTs) / bucketMs));

  // Create buckets
  const buckets = Array(bucketCount)
    .fill(null)
    .map((_, i) => ({
      bucketIndex: i,
      startTime: new Date(minTs + i * bucketMs).toISOString(),
      endTime: new Date(minTs + (i + 1) * bucketMs).toISOString(),
      count: 0,
      levels: { info: 0, warn: 0, error: 0 },
      samples: []
    }));

  // Distribute logs into buckets
  parsedLogs.forEach(log => {
    const ts = (log.timestampEpochMs && !isNaN(log.timestampEpochMs)) ? log.timestampEpochMs : new Date(log.timestamp).getTime();
    const bucketIdx = Math.floor((ts - minTs) / bucketMs);
    if (bucketIdx >= 0 && bucketIdx < buckets.length) {
      const bucket = buckets[bucketIdx];
      bucket.count++;
      bucket.levels[log.level] = (bucket.levels[log.level] || 0) + 1;
      if (bucket.samples.length < 3) {
        bucket.samples.push({
          timestamp: log.timestamp,
          level: log.level,
          message: log.message.substring(0, 100)
        });
      }
    }
  });

  // Remove empty leading/trailing buckets
  const firstNonEmpty = buckets.findIndex(b => b.count > 0);
  const lastNonEmpty = buckets.length - 1 - buckets.slice().reverse().findIndex(b => b.count > 0);

  const timeline = buckets.slice(
    Math.max(0, firstNonEmpty - 1),
    Math.min(buckets.length, lastNonEmpty + 2)
  );

  return {
    timeline,
    stats: {
      totalBuckets: timeline.length,
      minTimestamp: new Date(minTs).toISOString(),
      maxTimestamp: new Date(maxTs).toISOString(),
      durationMinutes: (maxTs - minTs) / (60 * 1000),
      totalLogs: parsedLogs.length,
      avgLogsPerBucket: Math.round(parsedLogs.length / timeline.length)
    }
  };
}

/**
 * Detects temporal patterns (recurring activity at specific times)
 */
function detectTemporalPatterns(parsedLogs) {
  const patterns = {
    byHour: {},
    byDay: {},
    byDayOfWeek: {}
  };

  parsedLogs.forEach(log => {
    const date = new Date(log.timestamp);
    const hour = date.getHours();
    const day = date.getDate();
    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];

    // Hour patterns
    patterns.byHour[hour] = (patterns.byHour[hour] || 0) + 1;

    // Day patterns
    patterns.byDay[day] = (patterns.byDay[day] || 0) + 1;

    // Day of week patterns
    patterns.byDayOfWeek[dayOfWeek] = (patterns.byDayOfWeek[dayOfWeek] || 0) + 1;
  });

  // Identify peak times
  const peakHour = Object.entries(patterns.byHour).sort((a, b) => b[1] - a[1])[0];
  const peakDayOfWeek = Object.entries(patterns.byDayOfWeek).sort((a, b) => b[1] - a[1])[0];

  return {
    byHour: patterns.byHour,
    byDay: patterns.byDay,
    byDayOfWeek: patterns.byDayOfWeek,
    peakHour: peakHour ? { hour: parseInt(peakHour[0]), count: peakHour[1] } : null,
    peakDayOfWeek: peakDayOfWeek ? { day: peakDayOfWeek[0], count: peakDayOfWeek[1] } : null
  };
}

/**
 * Detects temporal anomalies (unusual activity spikes/drops)
 */
function detectTemporalAnomalies(parsedLogs, threshold = 2.0) {
  const { timeline } = generateTimeline(parsedLogs, 5);

  if (timeline.length < 3) return { anomalies: [] };

  // Calculate mean and std dev
  const counts = timeline.map(b => b.count);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);

  // Identify anomalies (values > mean + threshold * stdDev)
  const anomalies = timeline
    .map((bucket, idx) => ({
      bucketIndex: idx,
      startTime: bucket.startTime,
      endTime: bucket.endTime,
      count: bucket.count,
      zScore: stdDev > 0 ? (bucket.count - mean) / stdDev : 0,
      type: bucket.count > mean + threshold * stdDev ? 'spike' : bucket.count < mean - threshold * stdDev ? 'drop' : null,
      samples: bucket.samples
    }))
    .filter(a => a.type !== null);

  return {
    anomalies,
    stats: {
      mean,
      stdDev,
      threshold,
      anomalyCount: anomalies.length
    }
  };
}

/**
 * Analyzes latency/duration metrics over time
 */
function analyzeMetricsTimeSeries(parsedLogs, metricKey = 'durationMs') {
  const timeSeries = parsedLogs
    .filter(log => log.metrics && log.metrics[metricKey] !== undefined)
    .map(log => ({
      timestamp: log.timestamp,
      value: log.metrics[metricKey],
      level: log.level
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (timeSeries.length === 0) {
    return { timeSeries: [], stats: null };
  }

  const values = timeSeries.map(ts => ts.value);
  const sorted = [...values].sort((a, b) => a - b);
  const stats = {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)]
  };

  // Bucket by time
  const buckets = {};
  timeSeries.forEach(ts => {
    const date = new Date(ts.timestamp);
    const hour = `${date.toISOString().split('T')[0]} ${date.getHours()}:00`;
    if (!buckets[hour]) {
      buckets[hour] = [];
    }
    buckets[hour].push(ts.value);
  });

  const bucketedStats = Object.entries(buckets).map(([time, vals]) => ({
    time,
    avg: vals.reduce((a, b) => a + b) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    count: vals.length
  }));

  return {
    timeSeries,
    stats,
    bucketedStats
  };
}

/**
 * Detects state change patterns and transitions
 */
function analyzeStateTransitions(parsedLogs) {
  const transitions = {};
  let prevState = null;

  parsedLogs
    .filter(log => log.stateChanges)
    .forEach(log => {
      const key = `${log.stateChanges.from}→${log.stateChanges.to}`;
      transitions[key] = (transitions[key] || 0) + 1;

      prevState = log.stateChanges.to;
    });

  return {
    transitions: Object.entries(transitions)
      .map(([key, count]) => {
        const [from, to] = key.split('→');
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count),
    totalTransitions: Object.values(transitions).reduce((a, b) => a + b, 0)
  };
}

/**
 * Comprehensive temporal analysis
 */
/**
 * Enterprise Chronological Analysis
 * Detects event velocity, significant time gaps (hangs), and traffic bursts.
 */
function analyzeTemporalInsights(parsedLogs) {
  if (parsedLogs.length < 2) return null;

  const sorted = [...parsedLogs]
    .filter(l => l.timestamp && !isNaN(new Date(l.timestamp)))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
  if (sorted.length < 2) return null;

  const startTime = new Date(sorted[0].timestamp).getTime();
  const endTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
  const totalDurationSec = (endTime - startTime) / 1000;

  const insights = {
    summary: '',
    eventVelocity: (parsedLogs.length / (totalDurationSec || 1)).toFixed(2), // events per second
    velocityStatus: 'Normal',
    timeGaps: [],
    bursts: []
  };

  const STALL_THRESHOLD_MS = 5000; 

  for (let i = 1; i < sorted.length; i++) {
    const currentTs = new Date(sorted[i].timestamp).getTime();
    const prevTs = new Date(sorted[i - 1].timestamp).getTime();
    const diff = currentTs - prevTs;

    if (diff > STALL_THRESHOLD_MS) {
      insights.timeGaps.push({
        from: sorted[i - 1].timestamp,
        to: sorted[i].timestamp,
        durationSec: (diff / 1000).toFixed(1)
      });
    }
    
    // Detect Bursts (High log volume in short time)
    if (diff < 5) { 
       const burstTime = new Date(sorted[i].timestamp).toISOString();
       if (!insights.bursts.find(b => b.time.substring(0, 16) === burstTime.substring(0, 16))) {
           insights.bursts.push({ time: burstTime, intensity: 'High' });
       }
    }
  }

  if (parseFloat(insights.eventVelocity) > 500) {
    insights.velocityStatus = 'High Pressure';
  }

  if (insights.timeGaps.length > 0) {
      insights.summary = `Detected ${insights.timeGaps.length} potential system stalls (gaps > 5s).`;
  }

  return insights;
}

/**
 * Predictive Health Scoring
 * Calculates a score from 0-100 based on log health indicators.
 */
function calculateHealthScore(parsedLogs, temporalInsights) {
  if (!parsedLogs || parsedLogs.length === 0) return 0;
  
  let score = 100;
  
  // 1. Error Rate Impact (Max -40 points)
  const errorCount = parsedLogs.filter(l => l.level === 'ERROR' || l.level === 'FATAL').length;
  const errorRatio = errorCount / parsedLogs.length;
  score -= Math.min(40, errorRatio * 200);
  
  // 2. Stability/Gaps Impact (Max -30 points)
  if (temporalInsights && temporalInsights.timeGaps) {
    score -= Math.min(30, temporalInsights.timeGaps.length * 10);
  }
  
  // 3. Pressure/Bursts Impact (Max -30 points)
  if (temporalInsights && temporalInsights.bursts) {
    score -= Math.min(30, temporalInsights.bursts.length * 5);
  }

  return Math.max(0, Math.round(score));
}

/**
 * Comparative Drift Analysis
 * Compares a source file's patterns against a baseline to find "New" behavior.
 */
function analyzeLogDrift(baselinePatterns, currentPatterns) {
  const baselineSet = new Set(baselinePatterns.map(p => p.template));
  const drift = {
    newPatterns: [],
    increasedIntensity: []
  };

  currentPatterns.forEach(p => {
    if (!baselineSet.has(p.template)) {
      drift.newPatterns.push({
        template: p.template,
        level: p.level,
        count: p.count
      });
    }
  });

  return {
    driftDetected: drift.newPatterns.length > 0,
    summary: `Found ${drift.newPatterns.length} new log patterns not present in baseline.`,
    details: drift
  };
}

function analyzeChronology(parsedLogs, options = {}) {
  const {
    bucketIntervalMinutes = 5,
    anomalyThreshold = 2.0
  } = options;

  const temporalInsights = analyzeTemporalInsights(parsedLogs);
  const healthScore = calculateHealthScore(parsedLogs, temporalInsights);

  return {
    healthScore,
    timeline: generateTimeline(parsedLogs, bucketIntervalMinutes),
    temporalInsights,
    patterns: detectTemporalPatterns(parsedLogs),
    anomalies: detectTemporalAnomalies(parsedLogs, anomalyThreshold),
    stateTransitions: analyzeStateTransitions(parsedLogs),
    metrics: {
      duration: analyzeMetricsTimeSeries(parsedLogs, 'durationMs'),
      statusCodes: analyzeMetricsTimeSeries(parsedLogs, 'statusCode')
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  generateTimeline,
  detectTemporalPatterns,
  detectTemporalAnomalies,
  analyzeMetricsTimeSeries,
  analyzeStateTransitions,
  analyzeChronology,
  analyzeLogDrift
};
