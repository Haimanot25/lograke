const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const tar = require('tar');

/**
 * Extracts raw log contents from an archive buffer.
 * Supports .zip, .gz, .tar, .tar.gz, .tgz files.
 * Returns an array of { name: string, content: string }
 */
function extractLogFiles(fileBuffer, originalName, uploadsDir) {
  const ext = path.extname(originalName).toLowerCase();
  
  // 1. GZIP files (.gz)
  if (ext === '.gz' && !originalName.endsWith('.tar.gz')) {
    try {
      const decompressed = zlib.gunzipSync(fileBuffer);
      return [{
        name: originalName.slice(0, -3),
        content: decompressed.toString('utf8')
      }];
    } catch (err) {
      throw new Error(`Failed to extract GZ file: ${err.message}`);
    }
  }

  // 2. ZIP archives (.zip)
  if (ext === '.zip') {
    try {
      const zip = new AdmZip(fileBuffer);
      const zipEntries = zip.getEntries();
      const files = [];
      
      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          // Ignore binary files, focus on text logs
          const content = entry.getData().toString('utf8');
          files.push({
            name: entry.entryName,
            content: content
          });
        }
      }
      return files;
    } catch (err) {
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

      // Synchronous extraction using tar library
      tar.x({
        file: tempArchivePath,
        cwd: extractDirPath,
        sync: true
      });

      // Recursively read extractDirPath
      const files = [];
      function readDirRecursive(dirPath, relativeDir = '') {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const relPath = relativeDir ? path.join(relativeDir, item) : item;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            readDirRecursive(fullPath, relPath);
          } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            files.push({
              name: relPath,
              content: content
            });
          }
        }
      }
      
      readDirRecursive(extractDirPath);

      // Clean up temp files
      try {
        fs.unlinkSync(tempArchivePath);
        fs.rmSync(extractDirPath, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('Failed to clean up temp extraction directories:', cleanupErr.message);
      }

      return files;
    } catch (err) {
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
