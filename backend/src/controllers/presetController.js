const presetService = require('../services/presetService');

const list = (req, res) => {
  try {
    res.json({ presets: presetService.list(req.query.kind) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = (req, res) => {
  try {
    const preset = presetService.create({
      name: req.body?.name,
      kind: req.body?.kind,
      payload: req.body?.payload,
    });
    res.status(201).json({ success: true, preset });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const remove = (req, res) => {
  try {
    const removed = presetService.remove(req.params.id);
    if (!removed) return res.status(404).json({ success: false, message: 'Preset not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { list, create, remove };
