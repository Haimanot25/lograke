/**
 * Storage retention (security finding #11 — unbounded disk growth).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const RetentionPruner = require('../../src/services/RetentionPruner');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RetentionPruner', () => {
  let tmpRoot;
  let uploadsDir;
  let ingestedDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lograke-retention-'));
    uploadsDir = path.join(tmpRoot, 'uploads');
    ingestedDir = path.join(tmpRoot, 'ingested');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(ingestedDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.STORAGE_MAX_AGE_DAYS;
  });

  function writeAged(dir, name, ageDays) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'raw log copy');
    const mtime = new Date(Date.now() - ageDays * DAY_MS);
    fs.utimesSync(file, mtime, mtime);
    return file;
  }

  it('is disabled by default (STORAGE_MAX_AGE_DAYS unset)', () => {
    const pruner = new RetentionPruner({ uploadsDir, ingestedDir });
    expect(pruner.enabled).toBe(false);
    expect(pruner.pruneOnce()).toEqual({ deleted: 0 });
    expect(pruner.start()).toBeNull();
  });

  it('prunes old files from uploads and data/ingested but keeps recent ones', () => {
    const oldUpload = writeAged(uploadsDir, 'old-upload.log', 40);
    const freshUpload = writeAged(uploadsDir, 'fresh.log', 1);
    const oldIngested = writeAged(ingestedDir, 'old-ingested.log', 40);
    const freshIngested = writeAged(ingestedDir, 'fresh-ingested.log', 1);

    const pruner = new RetentionPruner({ uploadsDir, ingestedDir, maxAgeDays: 30 });
    expect(pruner.enabled).toBe(true);
    const result = pruner.pruneOnce();

    expect(result.deleted).toBe(2);
    expect(fs.existsSync(oldUpload)).toBe(false);
    expect(fs.existsSync(oldIngested)).toBe(false);
    expect(fs.existsSync(freshUpload)).toBe(true);
    expect(fs.existsSync(freshIngested)).toBe(true);
  });

  it('prunes recursively in subdirectories but never follows symlinks', () => {
    const nested = path.join(uploadsDir, 'nested');
    fs.mkdirSync(nested);
    const oldNested = writeAged(nested, 'deep.log', 60);

    const outsideFile = writeAged(tmpRoot, 'outside.log', 60);
    const link = path.join(uploadsDir, 'link-to-outside.log');
    try {
      fs.symlinkSync(outsideFile, link);
    } catch {
      return; // symlinks unavailable (e.g. Windows without privilege) — skip
    }

    const pruner = new RetentionPruner({ uploadsDir, ingestedDir, maxAgeDays: 30 });
    pruner.pruneOnce();

    expect(fs.existsSync(oldNested)).toBe(false);
    // symlink itself is skipped: the link survives, and so does its target
    expect(fs.existsSync(link)).toBe(true);
    expect(fs.existsSync(outsideFile)).toBe(true);
  });

  it('reads the retention window from STORAGE_MAX_AGE_DAYS', () => {
    process.env.STORAGE_MAX_AGE_DAYS = '7';
    const pruner = new RetentionPruner({ uploadsDir, ingestedDir });
    expect(pruner.maxAgeDays).toBe(7);
    expect(pruner.enabled).toBe(true);

    const tooOld = writeAged(uploadsDir, 'week-old.log', 8);
    const justRight = writeAged(uploadsDir, 'days-old.log', 6);
    pruner.pruneOnce();
    expect(fs.existsSync(tooOld)).toBe(false);
    expect(fs.existsSync(justRight)).toBe(true);
  });

  it('start() sweeps immediately and stop() clears the interval', () => {
    const old = writeAged(uploadsDir, 'startup.log', 90);
    const pruner = new RetentionPruner({ uploadsDir, ingestedDir, maxAgeDays: 30, intervalMs: 60000 });
    const timer = pruner.start();
    expect(timer).not.toBeNull();
    expect(fs.existsSync(old)).toBe(false); // startup sweep ran synchronously
    pruner.stop();
    expect(pruner.timer).toBeNull();
  });
});
