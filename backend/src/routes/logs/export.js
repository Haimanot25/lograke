const { store } = require('./shared');

// Security finding #7 (CSV formula injection): spreadsheet applications
// execute cells beginning with = + - @ (also tab/CR). Neutralize with a
// leading apostrophe, which Excel/Sheets treat as a literal-text escape.
function neutralizeFormula(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function register(router) {
  // 11. Export matching logs (JSON, CSV, or Markdown) — capped at 10,000 entries
  router.get('/:fileId/export', (req, res) => {
    const { fileId } = req.params;
    const { format = 'json', level = 'all', search = '' } = req.query;
    const record = store.get(fileId);
    const EXPORT_CAP = 10000;

    if (!record) {
      return res.status(404).json({ error: 'File not found' });
    }

    let filtered = record.parsedLogs;
    if (level !== 'all') {
      filtered = filtered.filter(log => log.level && log.level.toLowerCase() === level.toLowerCase());
    }
    if (search.trim() !== '') {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(log => log.raw.toLowerCase().includes(searchLower));
    }

    const capped = filtered.length > EXPORT_CAP;
    const exportLogs = filtered.slice(0, EXPORT_CAP);

    if (format === 'csv') {
      const chunks = ['Index,Timestamp,Level,Message,IDs,Metadata\n'];
      exportLogs.forEach(log => {
        const idx = log.index;
        const ts = neutralizeFormula(log.timestamp);
        const lvl = neutralizeFormula(log.level.toUpperCase());
        const msg = `"${neutralizeFormula(log.message).replace(/"/g, '""')}"`;
        const idsStr = `"${neutralizeFormula(JSON.stringify(log.ids)).replace(/"/g, '""')}"`;
        const metaStr = `"${neutralizeFormula(JSON.stringify(log.metadata)).replace(/"/g, '""')}"`;
        chunks.push(`${idx},${ts},${lvl},${msg},${idsStr},${metaStr}\n`);
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="lograke_export_${fileId}.csv"`);
      return res.send(chunks.join(''));
    }

    if (format === 'markdown') {
      let md = `# Lograke Export Summary - ${record.name}\n\n`;
      md += `- **Export Date**: ${new Date().toLocaleString()}\n`;
      md += `- **Showing**: ${exportLogs.length} of ${filtered.length} matching lines${capped ? ` (capped at ${EXPORT_CAP})` : ''}\n`;
      md += `- **Filters**: Level: ${level}, Search: "${search}"\n\n`;
      
      md += '## Log Line Details\n\n';
      exportLogs.forEach(log => {
        md += `### [${log.timestamp}] [${log.level.toUpperCase()}] Log Entry #${log.index}\n`;
        md += `**Message**: \`${log.message}\`\n\n`;
        if (Object.keys(log.ids).length > 0) {
          md += `**Identifiers**:\n`;
          for (const [k, v] of Object.entries(log.ids)) {
            md += `- ${k}: \`${v}\`\n`;
          }
          md += '\n';
        }
        if (Object.keys(log.metadata).length > 0) {
          md += `**Metadata**:\n`;
          for (const [k, v] of Object.entries(log.metadata)) {
            md += `- ${k}: \`${v}\`\n`;
          }
          md += '\n';
        }
        md += '---\n\n';
      });

      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="lograke_export_${fileId}.md"`);
      return res.send(md);
    }

    // Default to JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="lograke_export_${fileId}.json"`);
    res.send(JSON.stringify({
      fileName: record.name,
      exportedAt: new Date().toISOString(),
      totalParsed: record.linesCount,
      exportedCount: exportLogs.length,
      capped,
      logs: exportLogs
    }, null, 2));
  });
}

module.exports = { register };
