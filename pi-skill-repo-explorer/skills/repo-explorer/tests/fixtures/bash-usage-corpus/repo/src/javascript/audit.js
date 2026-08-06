export function recordAudit(eventName, userId) {
  return `${eventName}:${userId}`;
}
