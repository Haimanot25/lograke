const express = require('express');
const { registerUser, authenticateUser, generateToken, requireAuth, auditLog } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/register', loginLimiter, validateBody({
  username: { required: true, type: 'string', minLength: 3, maxLength: 50 },
  password: { required: true, type: 'string', minLength: 6 }
}), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await registerUser(username, password);
    const token = generateToken({ id: user.id, username: user.username, role: user.role });
    auditLog(user.id, 'register', 'user', user.id, { username });
    res.cookie('lograke_token', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.status(201).json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    if (err.message === 'User already exists') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', loginLimiter, validateBody({
  username: { required: true, type: 'string' },
  password: { required: true, type: 'string' }
}), async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await authenticateUser(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = generateToken({ id: user.id, username: user.username, role: user.role });
    auditLog(user.id, 'login', 'user', user.id, { username });
    res.cookie('lograke_token', token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('lograke_token', { path: '/' });
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ success: true, user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

module.exports = router;
