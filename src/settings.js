import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DATA_DIR } from './config.js';

export const SETTINGS_PATH = join(DATA_DIR, 'settings.json');
export const DEFAULT_VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:alerts@radarnews.app';

export function readSettings(file = SETTINGS_PATH) {
  if (!existsSync(file)) return { vapid: null, vapidSubject: DEFAULT_VAPID_SUBJECT };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return {
      vapid: raw.vapid || null,
      vapidSubject: raw.vapidSubject || DEFAULT_VAPID_SUBJECT,
    };
  } catch {
    throw new Error('Configuración ilegible: restaurar settings.json; no se regeneran las claves push.');
  }
}

export function writeSettings(s, file = SETTINGS_PATH) {
  const clean = {
    vapid: s?.vapid || null,
    vapidSubject: s?.vapidSubject || DEFAULT_VAPID_SUBJECT,
  };
  mkdirSync(dirname(file), {recursive:true});
  const temp = file + '.tmp-' + process.pid;
  writeFileSync(temp, JSON.stringify(clean, null, 2), {mode:0o600});
  renameSync(temp, file);
  try { chmodSync(file, 0o600); } catch { /* windows */ }
  return clean;
}

/**
 * Retira cualquier clave o bloque de Gemini de settings.json sin mostrarla
 * y conservando intactas las claves VAPID de notificaciones.
 */
export function scrubGeminiFromSettings(file = SETTINGS_PATH) {
  if (!existsSync(file)) return { scrubbed: false, vapidPreserved: false };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const hadGemini = Boolean('gemini' in raw || 'GEMINI_API_KEY' in raw || 'geminiApiKey' in raw);
    const clean = {
      vapid: raw.vapid || null,
      vapidSubject: raw.vapidSubject || DEFAULT_VAPID_SUBJECT,
    };
    if (hadGemini || !raw.vapidSubject) {
      writeSettings(clean,file);
    }
    delete process.env.GEMINI_API_KEY;
    return {
      scrubbed: hadGemini,
      vapidPreserved: Boolean(clean.vapid?.publicKey && clean.vapid?.privateKey),
    };
  } catch {
    return { scrubbed: false, vapidPreserved: false };
  }
}
