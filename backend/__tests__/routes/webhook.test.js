/**
 * Integration tests for log sources and webhook ingestion.
 */
const request = require('supertest');
const { app } = require('../../src/index');

jest.setTimeout(30000);

describe('log sources', () => {
  let token;
  let sourceId;
  let apiKey;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'sources_admin', password: 'Str0ngPass!' });
    token = res.body.token;
  });

  it('requires authentication to manage sources', async () => {
    const res = await request(app).get('/api/log-sources');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid source type', async () => {
    const res = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'bad', type: 'carrier-pigeon' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type must be/i);
  });

  it('creates a webhook source with a generated API key', async () => {
    const res = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ci-webhook', type: 'webhook' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    sourceId = res.body.source.id;
    apiKey = res.body.source.config.apiKey;
    expect(apiKey).toMatch(/^[a-f0-9]{48}$/);
  });

  // Security fix #4 (webhook key hygiene): the ingest key is revealed exactly
  // once — in the creation response above — and redacted on every read-back.
  it('redacts the ingest key on read-back (revealed only at creation)', async () => {
    const res = await request(app)
      .get(`/api/log-sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.source.config.webhookUrl).toContain(`/api/logs/ingest/webhook/${sourceId}`);
    expect(res.body.source.config.apiKey).not.toBe(apiKey);
    expect(res.body.source.instructions.curl).not.toContain(apiKey);
    expect(res.body.source.instructions.curl).toContain('<API_KEY>');
    expect(res.body.source.instructions.apiKeyNote).toMatch(/revealed only when the source is created/i);
  });

  it('lists sources without leaking the key either', async () => {
    const res = await request(app)
      .get('/api/log-sources')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const list = res.body.sources.find(s => s.id === sourceId);
    expect(list).toBeDefined();
    expect(list.config.apiKey).not.toBe(apiKey);
    expect(list.instructions.curl).not.toContain(apiKey);
  });

  it('rejects webhook ingestion without an API key', async () => {
    const res = await request(app)
      .post(`/api/logs/ingest/webhook/${sourceId}`)
      .set('Content-Type', 'text/plain')
      .send('2026-10-18 11:00:00 ERROR no key provided');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/api key/i);
  });

  it('rejects webhook ingestion with a wrong API key', async () => {
    const res = await request(app)
      .post(`/api/logs/ingest/webhook/${sourceId}`)
      .set('X-API-Key', 'wrong-key')
      .set('Content-Type', 'text/plain')
      .send('2026-10-18 11:00:01 ERROR wrong key');
    expect(res.status).toBe(401);
  });

  it('starts the webhook source', async () => {
    const res = await request(app)
      .post(`/api/log-sources/${sourceId}/start`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // Runs against the STARTED source so SourceWebhook.validateApiKey is hit
  // with a wrong key of identical length (the timing-safe compare path)
  it('rejects a same-length wrong key while running', async () => {
    const res = await request(app)
      .post(`/api/logs/ingest/webhook/${sourceId}`)
      .set('X-API-Key', '0'.repeat(48))
      .set('Content-Type', 'text/plain')
      .send('2026-10-18 11:00:01b ERROR wrong key');
    expect(res.status).toBe(401);
  });

  it('accepts webhook ingestion with the correct API key', async () => {
    const res = await request(app)
      .post(`/api/logs/ingest/webhook/${sourceId}`)
      .set('X-API-Key', apiKey)
      .set('Content-Type', 'text/plain')
      .send([
        '2026-10-18 11:00:02 ERROR payment gateway timeout',
        '2026-10-18 11:00:03 INFO retry succeeded',
      ].join('\n'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accepted).toBe(2);
  });

  it('stores webhook lines as a log file', async () => {
    const res = await request(app)
      .get('/api/logs/files')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const webhookFile = res.body.files.find(f => f.name && f.name.startsWith(`webhook_${sourceId}`));
    expect(webhookFile).toBeDefined();
    expect(webhookFile.linesCount).toBe(2);
  });

  it('deletes the source', async () => {
    const res = await request(app)
      .delete(`/api/log-sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const after = await request(app)
      .get(`/api/log-sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(404);
  });
});

describe('SFTP host allowlist (finding #10)', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sources_admin', password: 'Str0ngPass!' });
    token = res.body.token;
  });

  afterEach(() => {
    delete process.env.SFTP_ALLOWED_HOSTS;
  });

  it('rejects creating an SFTP source outside SFTP_ALLOWED_HOSTS', async () => {
    process.env.SFTP_ALLOWED_HOSTS = 'sftp.internal.example';
    const res = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'sftp-blocked', type: 'sftp', config: { host: 'evil.example.com', remotePath: '/' } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/SFTP_ALLOWED_HOSTS/);
  });

  it('allows listed hosts (case- and whitespace-insensitive)', async () => {
    process.env.SFTP_ALLOWED_HOSTS = ' sftp.internal.example , backup.example ';
    const res = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'sftp-ok', type: 'sftp', config: { host: 'SFTP.Internal.Example', remotePath: '/' } });
    expect(res.status).toBe(200);
    await request(app)
      .delete(`/api/log-sources/${res.body.source.id}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('allows any host when the allowlist is unset (backward compatible)', async () => {
    const res = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'sftp-open', type: 'sftp', config: { host: '10.0.0.5', remotePath: '/' } });
    expect(res.status).toBe(200);
    await request(app)
      .delete(`/api/log-sources/${res.body.source.id}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('blocks sftp-list before any connection is attempted', async () => {
    const created = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'sftp-list-guard', type: 'sftp', config: { host: '10.0.0.5', remotePath: '/' } });
    expect(created.status).toBe(200);
    process.env.SFTP_ALLOWED_HOSTS = 'sftp.internal.example';
    const res = await request(app)
      .post(`/api/log-sources/${created.body.source.id}/sftp-list`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/SFTP_ALLOWED_HOSTS/);
    await request(app)
      .delete(`/api/log-sources/${created.body.source.id}`)
      .set('Authorization', `Bearer ${token}`);
  });
});

describe('webhook key rotation hygiene', () => {
  let token;
  let sourceId;
  let apiKey;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sources_admin', password: 'Str0ngPass!' });
    token = res.body.token;
    const created = await request(app)
      .post('/api/log-sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'key-hygiene', type: 'webhook' });
    sourceId = created.body.source.id;
    apiKey = created.body.source.config.apiKey;
    expect(apiKey).toMatch(/^[a-f0-9]{48}$/);
  });

  afterAll(async () => {
    await request(app)
      .delete(`/api/log-sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('ignores the masked placeholder when a config is written back', async () => {
    const sourceManager = require('../../src/services/SourceManager');
    const res = await request(app)
      .put(`/api/log-sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { apiKey: '••••••' } });
    expect(res.status).toBe(200);
    // stored key survives a UI round-trip that echoes the masked value
    expect(sourceManager.getById(sourceId).config.apiKey).toBe(apiKey);
  });

  it('still accepts the original key after the masked write-back', async () => {
    const sourceManager = require('../../src/services/SourceManager');
    await sourceManager.start(sourceId);
    const res = await request(app)
      .post(`/api/logs/ingest/webhook/${sourceId}`)
      .set('X-API-Key', apiKey)
      .set('Content-Type', 'text/plain')
      .send('2026-10-18 12:00:00 INFO key survived masked write-back');
    expect(res.status).toBe(200);
    await sourceManager.stop(sourceId);
  });
});
