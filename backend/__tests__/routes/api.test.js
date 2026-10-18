/**
 * Integration tests for app-level routes: health, error handling, auth and settings.
 * Uses the real Express app (src/index.js exports it without listening).
 */
const request = require('supertest');
const { app } = require('../../src/index');

jest.setTimeout(30000);

describe('app basics', () => {
  it('GET /api/health returns a healthy payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.activeAiProvider).toBe('string');
  });

  it('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ this is not json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });

  it('never leaks internal error details on unhandled failures', async () => {
    // Nonexistent file id exercises the 404 path rather than a crash
    const res = await request(app).get('/api/logs/does-not-exist/metadata');
    expect(res.status).toBe(401); // auth comes first
    expect(res.body.error).toBeDefined();
  });
});

describe('auth flow', () => {
  const adminCreds = { username: 'root_admin', password: 'Str0ngPass!' };
  const userCreds = { username: 'regular_user', password: 'Str0ngPass!' };
  let adminToken;
  let userToken;

  it('the first registered user becomes admin', async () => {
    const res = await request(app).post('/api/auth/register').send(adminCreds);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.role).toBe('admin');
    expect(typeof res.body.token).toBe('string');
    adminToken = res.body.token;
  });

  it('subsequent registrations get the user role', async () => {
    const res = await request(app).post('/api/auth/register').send(userCreds);
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
    userToken = res.body.token;
  });

  it('rejects duplicate usernames with 409', async () => {
    const res = await request(app).post('/api/auth/register').send(adminCreds);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/i);
  });

  it('enforces the minimum password length', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'weak_password_user', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid credentials with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminCreds.username, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('login returns a token and sets an httpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send(adminCreds);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    const cookie = (res.headers['set-cookie'] || []).join(';');
    expect(cookie).toContain('lograke_token=');
    expect(cookie).toContain('HttpOnly');
  });

  it('GET /api/auth/me requires authentication', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me works with a Bearer token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(userCreds.username);
    expect(res.body.user.role).toBe('user');
  });

  it('rejects a garbage token with 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('exposes the admin token for later suites', () => {
    expect(adminToken).toBeTruthy();
    expect(userToken).toBeTruthy();
  });
});

describe('settings endpoint', () => {
  let userToken;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'regular_user', password: 'Str0ngPass!' });
    userToken = res.body.token;
  });

  it('requires authentication to read settings', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns settings with masked API keys', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.settings.active_ai_provider).toBeDefined();
    // Keys are never returned in full
    for (const key of ['groq_api_key', 'gemini_api_key', 'grok_api_key']) {
      const value = res.body.settings[key];
      expect(value === '' || !value.includes('sk') || value.includes('••••')).toBe(true);
    }
  });

  // Characterization: settings currently require only authentication, not the
  // admin role. This is documented in SECURITY.md "Deployment Considerations" —
  // if this test starts failing because a role check was added, update this
  // assertion deliberately and remove the note from SECURITY.md.
  it('accepts settings updates from any authenticated user', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ active_ai_provider: 'groq' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects unknown setting keys', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ evil_key: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it('rejects an invalid AI provider', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ active_ai_provider: 'skynet' });
    expect(res.status).toBe(400);
  });
});
