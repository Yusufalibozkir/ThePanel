const crypto = require('crypto');
const { db, query } = require('../config/database');

// Credential vault: channel credentials are encrypted at rest with
// AES-256-GCM using APP_ENCRYPTION_KEY (64-char hex = 32 bytes).
// Raw credentials are never returned by the API — only masked previews.

const getKey = () => {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'APP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
};

const encryptJson = (obj) => {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  });
};

const decryptJson = (blob) => {
  const envelope = JSON.parse(blob);
  if (envelope.alg !== 'aes-256-gcm' || envelope.v !== 1) {
    throw new Error('unsupported credential envelope');
  }
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
};

// Show e.g. "shpss_ab…77ec" — never more than a hint.
const maskValue = (value) => {
  const s = String(value || '');
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
};

class CredentialService {
  // Field names worth surfacing in a masked preview
  static PREVIEW_FIELDS = [
    'client_id',
    'client_secret',
    'refresh_token',
    'access_token',
    'dev_id',
    'app_id',
    'cert_id',
    'api_key',
    'shared_secret',
  ];

  save(platform, credentials) {
    if (typeof credentials !== 'object' || credentials === null) {
      throw new Error('credentials must be an object');
    }
    const encrypted = encryptJson(credentials);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    db.prepare(
      `INSERT INTO platform_credentials (platform, credentials, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(platform) DO UPDATE SET credentials = excluded.credentials, updated_at = excluded.updated_at`
    ).run(platform, encrypted, now, now);
    return this.getMasked(platform);
  }

  // Server-side only — decrypts. Never wire this into a route response.
  get(platform) {
    const row = query('SELECT * FROM platform_credentials WHERE platform = ?', [platform]).rows[0];
    if (!row) return null;
    let credentials;
    try {
      credentials = decryptJson(row.credentials);
    } catch {
      credentials = { _error: 'failed to decrypt (APP_ENCRYPTION_KEY changed?)' };
    }
    return {
      platform: row.platform,
      credentials,
      token_expires_at: row.token_expires_at,
      last_validated_at: row.last_validated_at,
    };
  }

  getMasked(platform) {
    const row = query('SELECT * FROM platform_credentials WHERE platform = ?', [platform]).rows[0];
    if (!row) return null;
    let preview = {};
    try {
      const decrypted = decryptJson(row.credentials);
      for (const field of CredentialService.PREVIEW_FIELDS) {
        if (decrypted[field]) preview[field] = maskValue(decrypted[field]);
      }
      preview._field_count = Object.keys(decrypted).length;
    } catch {
      preview._error = 'stored credentials unreadable with current key';
    }
    return {
      platform: row.platform,
      preview,
      token_expires_at: row.token_expires_at,
      last_validated_at: row.last_validated_at,
      updated_at: row.updated_at,
    };
  }

  getAllMasked() {
    const rows = query('SELECT platform FROM platform_credentials').rows;
    return rows.map((r) => this.getMasked(r.platform));
  }

  markValidated(platform, tokenExpiresAt = null) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    query('UPDATE platform_credentials SET last_validated_at = ?, token_expires_at = ? WHERE platform = ?', [
      now,
      tokenExpiresAt,
      platform,
    ]);
    return this.getMasked(platform);
  }

  remove(platform) {
    query('DELETE FROM platform_credentials WHERE platform = ?', [platform]);
    return { success: true };
  }

  // Connection tests. eBay/Etsy go live in Phase 3/4; AbeBooks is an export
  // channel with nothing to test.
  async testConnection(platform) {
    const stored = this.get(platform);
    if (!stored) {
      return { success: false, message: 'No credentials stored for this platform' };
    }
    switch (platform) {
      case 'ebay':
        return { success: false, message: 'eBay connection test arrives with the Phase 3 adapter' };
      case 'etsy':
        return { success: false, message: 'Etsy connection test arrives with the Phase 4 adapter' };
      case 'abebooks':
        return { success: true, message: 'AbeBooks is an export channel — no connection needed' };
      default:
        return { success: false, message: `Unknown platform: ${platform}` };
    }
  }
}

module.exports = new CredentialService();
