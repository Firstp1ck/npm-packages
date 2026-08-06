import { createSession } from './session';

export interface LoginRequest {
  userId: string;
}

export async function loginUser(request: LoginRequest) {
  return createSession(request.userId);
}
