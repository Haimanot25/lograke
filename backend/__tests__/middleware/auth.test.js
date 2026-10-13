const { generateToken, verifyToken, hashPassword, comparePassword, registerUser, requireAuth, optionalAuth } = require('../../src/middleware/auth');
const jwt = require('jsonwebtoken');
const db = require('../../src/db');

// Clean up test users between runs
beforeAll(() => {
  db.prepare("DELETE FROM users WHERE username IN ('testuser', 'dupuser')").run();
});

// ── Token helpers ──────────────────────────────────────────────
describe('generateToken / verifyToken', () => {
  it('should generate a valid JWT token', () => {
    const token = generateToken({ username: 'admin' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('should verify a valid token and return decoded payload', () => {
    const payload = { username: 'admin', role: 'admin' };
    const token = generateToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.username).toBe('admin');
    expect(decoded.role).toBe('admin');
  });

  it('should throw on invalid token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });

  it('should throw on tampered token', () => {
    const token = generateToken({ username: 'admin' });
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyToken(tampered)).toThrow();
  });
});

// ── Password hashing ──────────────────────────────────────────
describe('hashPassword / comparePassword', () => {
  it('should hash a password and verify it', async () => {
    const hash = await hashPassword('testpass123');
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe('testpass123');

    const match = await comparePassword('testpass123', hash);
    expect(match).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const hash = await hashPassword('correct');
    const match = await comparePassword('wrong', hash);
    expect(match).toBe(false);
  });
});

// ── User registration ─────────────────────────────────────────
describe('registerUser', () => {
  afterAll(() => {
    db.prepare("DELETE FROM users WHERE username IN ('testuser', 'dupuser')").run();
  });

  it('should register a new user', async () => {
    const user = await registerUser('testuser', 'pass123');
    expect(user.username).toBe('testuser');
    expect(user.id).toMatch(/^user_/);
  });

  it('should throw for duplicate username', async () => {
    await registerUser('dupuser', 'pass');
    await expect(registerUser('dupuser', 'pass2')).rejects.toThrow('User already exists');
  });
});

// ── requireAuth middleware ─────────────────────────────────────
describe('requireAuth middleware', () => {
  it('should call next() when AUTH_ENABLED is false', () => {
    process.env.AUTH_ENABLED = 'false';
    const req = {};
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when no Authorization header', () => {
    process.env.AUTH_ENABLED = 'true';
    const req = { headers: {} };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for invalid token', () => {
    process.env.AUTH_ENABLED = 'true';
    const req = { headers: { authorization: 'Bearer invalidtoken' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should call next() and set req.user for valid token', () => {
    process.env.AUTH_ENABLED = 'true';
    const token = generateToken({ username: 'admin' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('admin');
  });
});

// ── optionalAuth middleware ────────────────────────────────────
describe('optionalAuth middleware', () => {
  it('should call next() without setting req.user when no token', () => {
    process.env.AUTH_ENABLED = 'true';
    const req = { headers: {} };
    const res = {};
    const next = jest.fn();
    optionalAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('should set req.user when valid token provided', () => {
    process.env.AUTH_ENABLED = 'true';
    const token = generateToken({ username: 'test' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};
    const next = jest.fn();
    optionalAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('test');
  });
});
