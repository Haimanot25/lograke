const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const {
  suggestFields, createParser, updateParser, getParsers, getParser,
  deleteParser, previewRegex, applyParser, testParser, exportParser, importParser, verifyRegex
} = require('../services/CustomParserService');

function sendRouteError(res, err, opLabel) {
  if (err.isOperational) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  logger.error(`${opLabel} failed:`, err.message || err);
  return res.status(500).json({ error: 'Internal server error' });
}

// POST /api/parsers/suggest — AI field suggestions from sample lines
router.post('/suggest', requireAuth, (req, res) => {
  try {
    const { sampleLines } = req.body;
    if (!sampleLines || !sampleLines.trim()) {
      return res.status(400).json({ error: 'Sample lines required' });
    }
    const result = suggestFields(sampleLines);
    res.json(result);
  } catch (err) {
    sendRouteError(res, err, 'parsers/suggest');
  }
});

// POST /api/parsers/preview — Live regex preview against sample text
router.post('/preview', requireAuth, (req, res) => {
  try {
    const { regexPattern, testLines } = req.body;
    if (!regexPattern || !testLines) {
      return res.status(400).json({ error: 'regexPattern and testLines required' });
    }
    const result = previewRegex(regexPattern, testLines);
    res.json(result);
  } catch (err) {
    sendRouteError(res, err, 'parsers/preview');
  }
});

// POST /api/parsers/verify — Validate regex syntax
router.post('/verify', requireAuth, (req, res) => {
  try {
    const { regexPattern } = req.body;
    res.json(verifyRegex(regexPattern || ''));
  } catch (err) {
    sendRouteError(res, err, 'parsers/verify');
  }
});

// GET /api/parsers — List all parsers
router.get('/', requireAuth, (req, res) => {
  try {
    const { search, tag } = req.query;
    const parsers = getParsers(search, tag);
    res.json({ parsers });
  } catch (err) {
    sendRouteError(res, err, 'parsers/list');
  }
});

// GET /api/parsers/:id — Get single parser
router.get('/:id', requireAuth, (req, res) => {
  try {
    const parser = getParser(req.params.id);
    if (!parser) return res.status(404).json({ error: 'Parser not found' });
    res.json({ parser });
  } catch (err) {
    sendRouteError(res, err, 'parsers/get');
  }
});

// POST /api/parsers — Create new parser
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { name, description, sampleLines, fields, tags, multiLine, delimiter, regexPattern } = req.body;
    if (!name || !fields?.length) {
      return res.status(400).json({ error: 'Parser name and fields required' });
    }
    const parser = createParser(name, description, sampleLines, fields, tags, { multiLine, delimiter, regexPattern });
    res.status(201).json({ success: true, parser });
  } catch (err) {
    sendRouteError(res, err, 'parsers/create');
  }
});

// PUT /api/parsers/:id — Update parser
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const parser = updateParser(req.params.id, req.body);
    res.json({ success: true, parser });
  } catch (err) {
    sendRouteError(res, err, 'parsers/update');
  }
});

// DELETE /api/parsers/:id — Delete parser
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    deleteParser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    sendRouteError(res, err, 'parsers/delete');
  }
});

// POST /api/parsers/:id/test — Test parser against sample logs
router.post('/:id/test', requireAuth, (req, res) => {
  try {
    const { testLogLines } = req.body;
    if (!testLogLines) return res.status(400).json({ error: 'testLogLines required' });
    const result = testParser(req.params.id, testLogLines);
    res.json(result);
  } catch (err) {
    sendRouteError(res, err, 'parsers/test');
  }
});

// GET /api/parsers/:id/test — Get last saved test results
router.get('/:id/test', requireAuth, (req, res) => {
  try {
    const parser = getParser(req.params.id);
    if (!parser) return res.status(404).json({ error: 'Parser not found' });
    res.json({ testResults: parser.testResults });
  } catch (err) {
    sendRouteError(res, err, 'parsers/get-test');
  }
});

// GET /api/parsers/:id/export — Export parser as JSON
router.get('/:id/export', requireAuth, (req, res) => {
  try {
    const data = exportParser(req.params.id);
    res.json(data);
  } catch (err) {
    sendRouteError(res, err, 'parsers/export');
  }
});

// POST /api/parsers/import — Import parser from JSON
router.post('/import', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const parser = importParser(req.body);
    res.status(201).json({ success: true, parser });
  } catch (err) {
    sendRouteError(res, err, 'parsers/import');
  }
});

module.exports = router;
