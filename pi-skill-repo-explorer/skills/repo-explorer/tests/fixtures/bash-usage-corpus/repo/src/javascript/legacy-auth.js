const { recordAudit } = require('./audit');

export function legacyLogin(userId) {
  recordAudit('legacy-login', userId);
  return Boolean(userId);
}
