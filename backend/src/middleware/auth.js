const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const { jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN } = config.auth;
function isAuthEnabled() { return config.auth.enabled; }

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function registerUser(username, password) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    throw new Error('User already exists');
  }
  const passwordHash = await hashPassword(password);
  const id = `user_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  // First registered user becomes admin (no awaits between check and insert)
  const isFirstUser = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const role = isFirstUser ? 'admin' : 'user';
  db.prepare('INSERT INTO users (id, username, passwordHash, role) VALUES (?, ?, ?, ?)').run(id, username, passwordHash, role);
  return { username, id, role };
}

async function authenticateUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) return null;
  return { username: user.username, id: user.id, role: user.role };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!isAuthEnabled()) return next();
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie.split(';').map(c => c.trim()).find(c => c.startsWith('lograke_token='));
    if (match) return match.split('=')[1];
  }
  return null;
}

function optionalAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = verifyToken(token);
  } catch (err) {
    // Token invalid but auth is optional
  }
  next();
}

function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function auditLog(userId, action, resource, resourceId, details) {
  try {
    db.prepare('INSERT INTO audit_log (userId, action, resource, resourceId, details) VALUES (?, ?, ?, ?, ?)').run(
      userId || 'system', action, resource || null, resourceId || null, details ? JSON.stringify(details) : null
    );
  } catch (err) {
    // Don't let audit failures break the request
    try { const l = require('./logger'); l.logger && l.logger.warn('Audit log write failed', err.message); } catch (e) { /* silent */ }
  }
}

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  registerUser,
  authenticateUser,
  requireAuth,
  requireRole,
  optionalAuth,
  auditLog
};
