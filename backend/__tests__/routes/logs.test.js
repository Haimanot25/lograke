/**
 * Integration tests for the /api/logs surface: ingest → list → query →
 * DSL → tags → export → delete, plus multipart upload.
 */
const request = require('supertest');
const { app } = require('../../src/index');

jest.setTimeout(60000);

const SAMPLE_LOGS = [
  '2026-10-18 10:00:01 ERROR Database connection failed host=db-1',
  '2026-10-18 10:00:02 INFO Server started successfully host=app-1',
  '2026-10-18 10:00:03 WARN Disk space low host=app-1',
  '2026-10-18 10:00:04 ERROR Timeout calling payment API host=app-2',
  '2026-10-18 10:00:05 INFO Request completed status=200 host=app-1',
].join('\n');

describe('logs lifecycle', () => {
  let token;
  let otherToken;
  let fileId;

  beforeAll(async () => {
    const first = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ingest_owner', password: 'Str0ngPass!' });
    token = first.body.token;

    const second = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ingest_observer', password: 'Str0ngPass!' });
    otherToken = second.body.token;
  });

  it('requires authentication for ingestion', async () => {
    const res = await request(app)
      .post('/api/logs/ingest/raw')
      .send({ sourceName: 'x.log', rawText: 'hello' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty ingestion payload', async () => {
    const res = await request(app)
      .post('/api/logs/ingest/raw')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceName: 'empty.log', rawText: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('ingests raw log lines and returns a file record', async () => {
    const res = await request(app)
      .post('/api/logs/ingest/raw')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceName: 'app.log', rawText: SAMPLE_LOGS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.file.id).toBeDefined();
    expect(res.body.file.linesCount).toBe(5);
    fileId = res.body.file.id;
  });

  it('lists the ingested file', async () => {
    const res = await request(app)
      .get('/api/logs/files')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.files.find(f => f.id === fileId);
    expect(found).toBeDefined();
    expect(found.name).toBe('app.log');
  });

  it('returns metadata with time buckets', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/metadata`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metadata.linesCount).toBe(5);
    expect(Array.isArray(res.body.metadata.timeBuckets)).toBe(true);
  });

  it('supports text search via /query', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/query`)
      .query({ search: 'Timeout' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.logs[0].message).toMatch(/timeout/i);
  });

  it('supports level filtering via /query', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/query`)
      .query({ level: 'error' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.logs.every(l => l.level === 'ERROR')).toBe(true);
  });

  it('supports key:value DSL queries', async () => {
    const res = await request(app)
      .post(`/api/logs/${fileId}/query-dsl`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'level:ERROR' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('supports regex: DSL queries', async () => {
    const res = await request(app)
      .post(`/api/logs/${fileId}/query-dsl`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'regex:payment.*API' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].message).toMatch(/payment/i);
  });

  it('returns zero results for a term that matches nothing', async () => {
    const res = await request(app)
      .post(`/api/logs/${fileId}/query-dsl`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'unicorn-munchies' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('adds and reads tags', async () => {
    const add = await request(app)
      .post(`/api/logs/${fileId}/tags`)
      .set('Authorization', `Bearer ${token}`)
      .send({ logIndex: 0, tags: ['release-blocker'] });
    expect(add.status).toBe(200);
    expect(add.body.success).toBe(true);

    const list = await request(app)
      .get(`/api/logs/${fileId}/tags`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Object.keys(list.body.tags).length).toBeGreaterThanOrEqual(1);
  });

  it('exports CSV with a header row and log content', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/export`)
      .query({ format: 'csv' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toBe('Index,Timestamp,Level,Message,IDs,Metadata');
    expect(res.text).toContain('Timeout calling payment API');
  });

  it('exports JSON with the full log array', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/export`)
      .query({ format: 'json' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const payload = JSON.parse(res.text);
    expect(payload.logs).toHaveLength(5);
    expect(payload.fileName).toBe('app.log');
  });

  it('exports Markdown', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/export`)
      .query({ format: 'markdown' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Lograke Export Summary');
  });

  it('accepts a multipart file upload', async () => {
    const res = await request(app)
      .post('/api/logs/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(SAMPLE_LOGS), 'upload-test.log');
    expect(res.status).toBe(200);
    expect(res.body.success || res.body.files || res.body.file).toBeTruthy();
  });

  it('returns 404 for an unknown file id', async () => {
    const res = await request(app)
      .get('/api/logs/nope/metadata')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // Security fix #2 (per-file authorization): uploads are owned by their
  // creator (ingest_owner, first-registered admin here) and non-admin users
  // cannot read other users' files. Ownerless files (source-driven ingestion,
  // legacy rows) remain shared — see SECURITY.md.
  it('blocks non-admin users from reading files owned by someone else', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/metadata`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it('lets the owner read their own file', async () => {
    const res = await request(app)
      .get(`/api/logs/${fileId}/metadata`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('hides other users\' files from the file list', async () => {
    const res = await request(app)
      .get('/api/logs/files')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    const found = res.body.files.find(f => f.id === fileId);
    expect(found).toBeUndefined();
  });

  it('deletes the file and its analysis', async () => {
    const del = await request(app)
      .delete(`/api/logs/${fileId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const after = await request(app)
      .get(`/api/logs/${fileId}/metadata`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(404);
  });
});
