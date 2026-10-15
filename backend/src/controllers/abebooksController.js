const abebooksExportService = require('../services/abebooksExportService');

// POST /api/abebooks/export/preview — compose the export without side
// effects: rows with computed prices, plus the skip report (who is blocked
// and why). Body: { mode: 'full' | 'delta' | 'selection', productIds?: [] }
const previewExport = async (req, res) => {
  try {
    const result = await abebooksExportService.buildExport({
      mode: req.body?.mode,
      productIds: req.body?.productIds,
    });
    res.json({
      success: true,
      mode: result.mode,
      rows: result.rows,
      skipped: result.skipped,
      summary: { included: result.rows.length, skipped: result.skipped.length },
    });
  } catch (error) {
    console.error('Error previewing AbeBooks export:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// POST /api/abebooks/export/generate — build the TSV, mark included books
// as exported (the delta baseline moves), and log the run. Returns the file
// content for download.
const generateExport = async (req, res) => {
  try {
    const result = await abebooksExportService.generate({
      mode: req.body?.mode,
      productIds: req.body?.productIds,
    });
    res.json({
      success: true,
      message: `Export generated — ${result.count} books included, ${result.skipped.length} skipped`,
      filename: result.filename,
      content: result.content,
      count: result.count,
      skipped: result.skipped,
      mode: result.mode,
    });
  } catch (error) {
    console.error('Error generating AbeBooks export:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = { previewExport, generateExport };
