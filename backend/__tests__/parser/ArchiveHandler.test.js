/**
 * Decompression-bomb guards for ArchiveHandler (security finding #6).
 *
 * The env caps MUST be set before src/config.js loads, so they are assigned
 * before the first require of the module under test.
 */
process.env.ARCHIVE_MAX_EXTRACTED_MB = '1'; // 1 MB extraction budget
process.env.ARCHIVE_MAX_ENTRIES = '5';

const zlib = require('zlib');
const AdmZip = require('adm-zip');
const { extractLogFiles } = require('../../src/parser/ArchiveHandler');

const TMP = require('os').tmpdir();

function expectArchiveRejection(fn) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.isOperational).toBe(true);
  expect(err.statusCode).toBe(413);
}

describe('extractLogFiles — gzip bomb', () => {
  it('rejects a small .gz that inflates past the budget', () => {
    // 3MB of zeros compresses to a few KB — the classic zip-bomb shape
    const bomb = zlib.gzipSync(Buffer.alloc(3 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100 * 1024); // tiny on the wire
    expectArchiveRejection(() => extractLogFiles(bomb, 'huge.log.gz', TMP));
  });

  it('still extracts a .gz that fits the budget', () => {
    const small = zlib.gzipSync(Buffer.from('2026-10-18 10:00:00 INFO all good\n'));
    const files = extractLogFiles(small, 'small.log.gz', TMP);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('small.log');
    expect(files[0].content).toContain('all good');
  });
});

describe('extractLogFiles — zip bombs', () => {
  it('rejects a zip whose declared entry size exceeds the budget', () => {
    const zip = new AdmZip();
    zip.addFile('big.log', Buffer.alloc(2 * 1024 * 1024, 'A'));
    expectArchiveRejection(() => extractLogFiles(zip.toBuffer(), 'big.zip', TMP));
  });

  it('rejects a zip with more entries than allowed', () => {
    const zip = new AdmZip();
    for (let i = 0; i < 6; i++) zip.addFile(`part-${i}.log`, Buffer.from('line\n'));
    expectArchiveRejection(() => extractLogFiles(zip.toBuffer(), 'many.zip', TMP));
  });

  it('rejects when cumulative actual bytes cross the budget', () => {
    const zip = new AdmZip();
    // declared sizes pass individually; the running total must still trip
    zip.addFile('a.log', Buffer.alloc(600 * 1024, 'A'));
    zip.addFile('b.log', Buffer.alloc(600 * 1024, 'B'));
    expectArchiveRejection(() => extractLogFiles(zip.toBuffer(), 'total.zip', TMP));
  });

  it('extracts a normal zip under the caps', () => {
    const zip = new AdmZip();
    zip.addFile('app.log', Buffer.from('2026-10-18 10:00:01 WARN disk low\n'));
    const files = extractLogFiles(zip.toBuffer(), 'ok.zip', TMP);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('app.log');
    expect(files[0].content).toContain('disk low');
  });

  it('skips zip entries with path traversal names', () => {
    const zip = new AdmZip();
    zip.addFile('safe.log', Buffer.from('ok\n'));
    zip.addFile('../escape.log', Buffer.from('bad\n'));
    const files = extractLogFiles(zip.toBuffer(), 'traversal.zip', TMP);
    expect(files.map(f => f.name)).not.toContain('../escape.log');
    expect(files.map(f => f.name)).toContain('safe.log');
  });
});

describe('extractLogFiles — plain text passthrough', () => {
  it('treats non-archives as plain logs without caps applying', () => {
    const files = extractLogFiles(
      Buffer.from('2026-10-18 10:00:02 INFO plain text\n'),
      'plain.log',
      TMP
    );
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('plain text');
  });
});

afterAll(() => {
  delete process.env.ARCHIVE_MAX_EXTRACTED_MB;
  delete process.env.ARCHIVE_MAX_ENTRIES;
});
