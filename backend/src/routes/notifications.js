const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const {
  addSSEClient,
  getNotificationSettings,
  createNotificationSetting,
  updateNotificationSetting,
  deleteNotificationSetting
} = require('../services/NotificationService');

router.get('/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  addSSEClient(res);
  req.on('close', () => {});
});

router.get('/settings', requireAuth, (req, res) => {
  try {
    res.json({ settings: getNotificationSettings() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load notification settings' });
  }
});

router.post('/settings', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { channel, config, severityFilter, enabled } = req.body;
    if (!channel || !['webhook', 'browser', 'email'].includes(channel)) {
      return res.status(400).json({ error: 'Invalid channel. Must be webhook, browser, or email.' });
    }
    const setting = createNotificationSetting({ channel, config, severityFilter, enabled });
    res.json({ success: true, setting });
  } catch (err) {
    logger.error('Create notification setting failed:', err.message);
    res.status(err.isOperational ? (err.statusCode || 400) : 500)
      .json({ error: err.isOperational ? err.message : 'Failed to create notification setting' });
  }
});

router.put('/settings/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    updateNotificationSetting(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    logger.error('Update notification setting failed:', err.message);
    res.status(err.isOperational ? (err.statusCode || 400) : 500)
      .json({ error: err.isOperational ? err.message : 'Failed to update notification setting' });
  }
});

router.delete('/settings/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    deleteNotificationSetting(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete notification setting failed:', err.message);
    res.status(err.isOperational ? (err.statusCode || 400) : 500)
      .json({ error: err.isOperational ? err.message : 'Failed to delete notification setting' });
  }
});

module.exports = router;
