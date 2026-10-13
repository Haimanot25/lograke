const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileIngestor {
  constructor() {
    this.storageDir = path.resolve(__dirname, '../../data/ingested');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  ingest(fileBuffer, originalName) {
    const uniqueId = crypto.randomUUID();
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(this.storageDir, `${uniqueId}_${safeName}`);
    fs.writeFileSync(destPath, fileBuffer);
    return destPath;
  }
}

module.exports = FileIngestor;
