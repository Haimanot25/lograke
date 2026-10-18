const { addTag, getTagsForFile } = require('../../services/TagService');
const { store } = require('./shared');

function register(router) {
  // Tagging endpoints
  // Add tags to a specific log entry
  router.post('/:fileId/tags', (req, res) => {
    const { fileId } = req.params;
    const { logIndex, tags } = req.body;
    if (logIndex === undefined || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'logIndex and tags array required' });
    }
    try {
      const updated = addTag(store, fileId, Number(logIndex), tags);
      res.json({ success: true, tags: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add tag' });
    }
  });

  // Get all tags for all logs in a file
  router.get('/:fileId/tags', (req, res) => {
    const { fileId } = req.params;
    try {
      const tagsMap = getTagsForFile(store, fileId);
      res.json({ success: true, tags: tagsMap });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load tags' });
    }
  });
}

module.exports = { register };
