const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const tar = require('tar');
const { logger } = require('../middleware/logger');
const config = require('../config');

const MAX_EXTRACTED_BYTES = config.upload.maxExtractedBytes;
const MAX_ARCHIVE_ENTRIES = config.upload.maxArchiveEntries;
const MAX_MB = Math.round(MAX_EXTRACTED_BYTES / (1024 * 1024));

// Operational 413 — surfaces to the client as a rejected upload, never a 500
function archiveError(message) {
  const err = new Error(message);
  err.isOperational = true;
  err.statusCode = 413;
  return err;
}

function tooLargeError() {
  return archiveError(`Archive rejected: extraction exceeds ${MAX_MB}MB total or ${MAX_ARCHIVE_ENTRIES} entries`);
}

function hasPathTraversal(relPath) {
  if (path.isAbsolute(relPath)) return true;
  return String(relPath).split(/[/\\]/).includes('..');
}

/**
 * Extracts raw log contents from an archive buffer.
 * Supports .zip, .gz, .tar, .tar.gz, .tgz files.
 *
 * Decompression-bomb guards (security finding #6): total extracted bytes and
 * entry counts are capped (ARCHIVE_MAX_EXTRACTED_MB / ARCHIVE_MAX_ENTRIES),
 * archive links and path-traversal entries are dropped, and .gz output is
 * bounded during inflation.
 *
 * Returns an array of { name: string, content: string }
 */
function extractLogFiles(fileBuffer, originalName, uploadsDir) {
  const ext = path.extname(originalName).toLowerCase();

  // 1. GZIP files (.gz)
  if (ext === '.gz' && !originalName.endsWith('.tar.gz')) {
    let decompressed;
    try {
      // maxOutputLength aborts inflation as soon as the cap is passed
      decompressed = zlib.gunzipSync(fileBuffer, { maxOutputLength: MAX_EXTRACTED_BYTES });
    } catch (err) {
      if (err.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large|memory/i.test(err.message || '')) {
        throw tooLargeError();
      }
      throw new Error(`Failed to extract GZ file: ${err.message}`);
    }
    return [{
      name: originalName.slice(0, -3),
      content: decompressed.toString('utf8')
    }];
  }

  // 2. ZIP archives (.zip)
  if (ext === '.zip') {
    let zip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch (err) {
      throw new Error(`Failed to extract ZIP archive: ${err.message}`);
    }
    try {
      const zipEntries = zip.getEntries();
      const files = [];
      let totalBytes = 0;

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;
        if (files.length >= MAX_ARCHIVE_ENTRIES) throw tooLargeError();
        if (hasPathTraversal(entry.entryName)) continue; // never serve ../ names

        // declared (header) size first, then actual bytes after inflate
        const declared = Number(entry.header && entry.header.size) || 0;
        if (declared > MAX_EXTRACTED_BYTES || totalBytes + declared > MAX_EXTRACTED_BYTES) throw tooLargeError();

        const content = entry.getData().toString('utf8');
        totalBytes += Buffer.byteLength(content, 'utf8');
        if (totalBytes > MAX_EXTRACTED_BYTES) throw tooLargeError();

        files.push({
          name: entry.entryName,
          content: content
        });
      }
      return files;
    } catch (err) {
      if (err.isOperational) throw err;
      throw new Error(`Failed to extract ZIP archive: ${err.message}`);
    }
  }

  // 3. TAR and TAR.GZ archives (.tar, .tar.gz, .tgz)
  if (ext === '.tar' || originalName.endsWith('.tar.gz') || originalName.endsWith('.tgz')) {
    try {
      // Create temp file path
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const tempArchiveName = `archive_${Date.now()}${ext}`;
      const tempArchivePath = path.join(uploadsDir, tempArchiveName);
      fs.writeFileSync(tempArchivePath, fileBuffer);

      const extractDirName = `extracted_${Date.now()}`;
      const extractDirPath = path.join(uploadsDir, extractDirName);
      fs.mkdirSync(extractDirPath, { recursive: true });

      // Guards evaluated during extraction so a bomb never lands on disk:
      // links dropped (symlink → host file disclosure), traversal dropped,
      // declared sizes counted against the cap (finding #6)
      let declaredBytes = 0;
      let fileEntries = 0;
      let exceeded = false;
      const guardFilter = (relPath, entry) => {
        if (exceeded) return false;
        if (hasPathTraversal(relPath)) return false;
        const type = entry && entry.type;
        if (type === 'SymbolicLink' || type === 'Link' || type === 'ContiguousFile') return false;
        if (type === 'File' || type === 'OldFile' || type === 'GNUDump') {
          fileEntries += 1;
          declaredBytes += Math.max(0, Number(entry.size) || 0);
          if (fileEntries > MAX_ARCHIVE_ENTRIES || declaredBytes > MAX_EXTRACTED_BYTES) {
            exceeded = true;
            throw tooLargeError();
          }
        }
        return true;
      };

      // Synchronous extraction using tar library
      try {
        tar.x({
          file: tempArchivePath,
          cwd: extractDirPath,
          sync: true,
          filter: guardFilter
        });
        // belt and braces: if tar ever swallows the filter's exception,
        // the budget flag still fails the extraction
        if (exceeded) throw tooLargeError();
      } catch (err) {
        // clean up before rethrowing (bomb abort or corrupt archive)
        try {
          fs.unlinkSync(tempArchivePath);
          fs.rmSync(extractDirPath, { recursive: true, force: true });
        } catch (cleanupErr) { /* best effort */ }
        if (err.isOperational) throw err;
        throw err;
      }

      // Recursively read extractDirContents (lstat — symlinks are never followed)
      const files = [];
      let actualBytes = 0;
      let actualEntries = 0;
      function readDirRecursive(dirPath, relativeDir = '') {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const relPath = relativeDir ? path.join(relativeDir, item) : item;
          const stat = fs.lstatSync(fullPath);
          if (stat.isSymbolicLink()) continue; // defense in depth: never read through links
          if (stat.isDirectory()) {
            readDirRecursive(fullPath, relPath);
          } else {
            actualEntries += 1;
            actualBytes += stat.size;
            if (actualEntries > MAX_ARCHIVE_ENTRIES || actualBytes > MAX_EXTRACTED_BYTES) {
              throw tooLargeError();
            }
            const content = fs.readFileSync(fullPath, 'utf8');
            files.push({
              name: relPath,
              content: content
            });
          }
        }
      }

      try {
        readDirRecursive(extractDirPath);
      } catch (err) {
        try {
          fs.unlinkSync(tempArchivePath);
          fs.rmSync(extractDirPath, { recursive: true, force: true });
        } catch (cleanupErr) { /* best effort */ }
        if (err.isOperational) throw err;
        throw err;
      }

      // Clean up temp files
      try {
        fs.unlinkSync(tempArchivePath);
        fs.rmSync(extractDirPath, { recursive: true, force: true });
      } catch (cleanupErr) {
        logger.warn('Failed to clean up temp extraction directories:', cleanupErr.message);
      }

      return files;
    } catch (err) {
      if (err.isOperational) throw err;
      throw new Error(`Failed to extract TAR archive: ${err.message}`);
    }
  }

  // If not archived, treat as plain text log
  return [{
    name: originalName,
    content: fileBuffer.toString('utf8')
  }];
}

module.exports = {
  extractLogFiles
};
