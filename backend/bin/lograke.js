#!/usr/bin/env node
/**
 * npm bin entry — `npx lograke` (or a global `lograke` install) starts the
 * HTTP server, including the bundled web UI when the package ships one.
 */
const { startServer } = require('../src/index.js');

startServer();
