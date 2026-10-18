const { scanTraceableEntities } = require('../../analyzer/CorrelationEngine');
const { store, wrapRoute } = require('./shared');

function register(router) {
  /* ----- Visualisation Graph Endpoint ----- */
  router.get('/visualisation/graph', wrapRoute((req, res) => {
    const { fileId } = req.query;
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }

    const entityMap = (record.entities && typeof record.entities === 'object' && !Array.isArray(record.entities))
      ? record.entities
      : {};
    const hasStoredEntities = Object.values(entityMap).some(bucket => bucket && typeof bucket === 'object' && Object.keys(bucket).length > 0);
    const effectiveEntityMap = hasStoredEntities ? entityMap : scanTraceableEntities(record.parsedLogs || []);

    // Build node set from structured entity sources only (no raw regex)
    const nodeWeights = {};
    Object.values(effectiveEntityMap).forEach(bucket => {
      if (!bucket || typeof bucket !== 'object') return;
      Object.entries(bucket).forEach(([value, count]) => {
        const id = String(value);
        nodeWeights[id] = (nodeWeights[id] || 0) + count;
      });
    });

    record.parsedLogs.forEach(log => {
      if (log.ids) {
        Object.values(log.ids).forEach(v => {
          if (v) { const id = String(v); nodeWeights[id] = (nodeWeights[id] || 0) + 1; }
        });
      }
      if (log.metadata) {
        Object.entries(log.metadata).forEach(([key, v]) => {
          if (v && String(v).trim()) {
            const id = String(v).trim();
            nodeWeights[id] = (nodeWeights[id] || 0) + 1;
          }
        });
      }
    });

    // Cap at 500 highest-weight nodes to prevent huge payloads
    const MAX_NODES = 500;
    const sortedNodes = Object.entries(nodeWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NODES);
    const allowedNodeIds = new Set(sortedNodes.map(([id]) => id));
    const nodes = sortedNodes.map(([id, weight]) => ({ id, weight }));

    // Build edges with deduplication and weights (only for allowed nodes)
    const edgeMap = {};
    record.parsedLogs.forEach(log => {
      const ids = log.ids ? Object.values(log.ids) : [];
      const normalized = ids.map(v => String(v)).filter(Boolean);
      if (normalized.length >= 2) {
        for (let i = 0; i < normalized.length - 1; i++) {
          const source = normalized[i];
          const target = normalized[i + 1];
          if (source === target) continue;
          if (!allowedNodeIds.has(source) || !allowedNodeIds.has(target)) continue;
          const key = source < target ? `${source}|||${target}` : `${target}|||${source}`;
          if (!edgeMap[key]) edgeMap[key] = { source, target, weight: 0 };
          edgeMap[key].weight++;
        }
      }
    });

    const edges = Object.values(edgeMap).sort((a, b) => b.weight - a.weight);

    return res.json({ nodes, edges });
  }));
}

module.exports = { register };
