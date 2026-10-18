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

  // Characterization: source read-back intentionally includes the ingest key and
  // ready-to-copy curl instructions so operators can wire up senders (the UI
  // surfaces the same value). All log-source endpoints require authentication.
  it('returns webhook setup instructions including the ingest key', async () => {
    const res = await request(app)
      .get(`/api/log-sources/${sourceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.source.config.webhookUrl).toContain(`/api/logs/ingest/webhook/${sourceId}`);
    expect(res.body.source.instructions.curl).toContain(apiKey);
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
