const credentialService = require('../services/credentialService');

const PLATFORMS = ['ebay', 'etsy', 'abebooks'];

const getAll = async (req, res) => {
  try {
    const stored = credentialService.getAllMasked();
    const byPlatform = Object.fromEntries(stored.map((c) => [c.platform, c]));
    // Always return all three platforms so the UI can show empty vaults
    const credentials = PLATFORMS.map((p) => byPlatform[p] || { platform: p, preview: {}, last_validated_at: null });
    res.json({ success: true, credentials });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load credentials', error: error.message });
  }
};

const save = async (req, res) => {
  try {
    const { platform } = req.params;
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `Unknown platform: ${platform}` });
    }
    const result = credentialService.save(platform, req.body);
    res.json({ success: true, message: 'Credentials stored (encrypted)', credentials: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const { platform } = req.params;
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `Unknown platform: ${platform}` });
    }
    credentialService.remove(platform);
    res.json({ success: true, message: 'Credentials removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const test = async (req, res) => {
  try {
    const { platform } = req.params;
    const result = await credentialService.testConnection(platform);
    if (result.success) {
      credentialService.markValidated(platform);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getAll, save, remove, test };
