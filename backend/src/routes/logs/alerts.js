const { createRule, deleteRule, getRules, evaluateAlerts } = require('../../analyzer/AlertEngine');
const { store } = require('./shared');

function register(router) {
  // 11. Alert rule management and evaluation
  router.post('/:fileId/alerts', (req, res) => {
    const { fileId } = req.params;
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const rule = createRule(fileId, req.body);
      const currentAlerts = evaluateAlerts(record);
      record.alerts = currentAlerts;
      res.json({ success: true, rule, activeAlerts: currentAlerts });
    } catch (err) {
      res.status(400).json({ error: 'Invalid alert rule' });
    }
  });

  router.get('/:fileId/alerts', (req, res) => {
    const { fileId } = req.params;
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json({ rules: getRules(fileId), alerts: record.alerts || [] });
  });

  router.get('/:fileId/alerts/evaluate', (req, res) => {
    const { fileId } = req.params;
    const record = store.get(fileId);
    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }
    const currentAlerts = evaluateAlerts(record);
    record.alerts = currentAlerts;
    res.json({ success: true, alerts: currentAlerts });
  });

  router.delete('/:fileId/alerts/:ruleId', (req, res) => {
    const { fileId, ruleId } = req.params;
    try {
      deleteRule(fileId, ruleId);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: 'Failed to delete rule' });
    }
  });
}

module.exports = { register };
