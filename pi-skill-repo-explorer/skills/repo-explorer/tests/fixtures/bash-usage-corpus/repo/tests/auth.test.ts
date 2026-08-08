import { loginUser } from '../src/typescript/auth/controller';

test('creates a session', async () => {
  expect((await loginUser({ userId: 'fixture' })).userId).toBe('fixture');
});
