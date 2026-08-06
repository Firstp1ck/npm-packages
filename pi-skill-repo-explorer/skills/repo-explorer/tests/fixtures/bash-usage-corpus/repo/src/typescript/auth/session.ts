export type Session = { id: string; userId: string };

export function createSession(userId: string): Session {
  return { id: `session-${userId}`, userId };
}
