const request = require('supertest');
const server = require('../index');

describe('Authentication endpoints', () => {
  afterAll(async () => {
    // Close the server after tests finish
    server.close();
  });

  test('register and login a new user', async () => {
    const uniqueEmail = `test${Date.now()}@example.com`;
    const password = 'Password123!';
    // Register
    const registerRes = await request(server)
      .post('/auth/register')
      .send({ email: uniqueEmail, password, role: 'admin' })
      .expect(201);
    expect(registerRes.body.token).toBeDefined();
    expect(registerRes.body.user.email).toBe(uniqueEmail);

    // Login
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: uniqueEmail, password })
      .expect(200);
    expect(loginRes.body.token).toBeDefined();
  });
});