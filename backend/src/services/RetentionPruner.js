const fs = require('fs');
const path = require('path');
const { logger } = require('../middleware/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Storage retention — security finding #11 (unbounded disk growth).
 *
 * Opt-in age-based pruning of raw log copies that are NOT the database:
 *   - backend/uploads/            (original upload files)
 *   - backend/data/ingested/      (copies written by FileIngestor)
 *
 * STORAGE_MAX_AGE_DAYS=N  → delete files older than N days on startup and
 *                           every hour afterwards. Default 0 = disabled
 *                           (backward compatible).
 *
 * Parsed logs live in SQLite and are never touched here — only the raw
 * file copies on disk.
 */
class RetentionPruner {
  constructor(options = {}) {
    this.uploadsDir = options.uploadsDir || path.join(__dirname, '../../uploads');
    this.ingestedDir = options.ingestedDir || path.join(__dirname, '../../data/ingested');
    this.maxAgeDays = options.maxAgeDays !== undefined
      ? Number(options.maxAgeDays)
      : (parseInt(process.env.STORAGE_MAX_AGE_DAYS, 10) || 0);
    this.intervalMs = options.intervalMs || HOUR_MS;
    this.timer = null;
  }

  get enabled() {
    return Number.isFinite(this.maxAgeDays) && this.maxAgeDays > 0;
  }

  // Delete files whose mtime is older than the retention window.
  // Symlinks are skipped (never followed); directories are left in place.
  pruneOnce() {
    if (!this.enabled) return { deleted: 0 };
    const cutoff = Date.now() - this.maxAgeDays * DAY_MS;
    let deleted = 0;
    for (const dir of [this.uploadsDir, this.ingestedDir]) {
      deleted += this.#pruneDir(dir, cutoff);
    }
    if (deleted > 0) {
      logger.info(`Storage retention: removed ${deleted} raw file(s) older than ${this.maxAgeDays} day(s)`);
    }
    return { deleted };
  }

  #pruneDir(dir, cutoff) {
    let deleted = 0;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return 0; // directory does not exist yet — nothing to prune
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          deleted += this.#pruneDir(full, cutoff);
        } else if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          deleted += 1;
        }
      } catch (err) {
        logger.warn(`Storage retention: could not prune ${full}: ${err.message}`);
      }
    }
    return deleted;
  }

  // Startup sweep + hourly interval. Returns the timer, or null when the
  // feature is disabled. Timer is unref'd so it never keeps the process up.
  start() {
    if (!this.enabled) return null;
    this.pruneOnce();
    if (this.timer) return this.timer;
    this.timer = setInterval(() => {
      try {
        this.pruneOnce();
      } catch (err) {
        logger.warn(`Storage retention sweep failed: ${err.message}`);
      }
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return this.timer;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = RetentionPruner;
