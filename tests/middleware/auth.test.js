import { jest } from '@jest/globals';
import { authMiddleware } from '../../src/middleware/auth.js';

describe('authMiddleware', () => {
  let req, res, next;

  beforeEach(() => {
    process.env.WEBHOOK_TOKEN = 'test_token_123';
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  afterEach(() => {
    delete process.env.WEBHOOK_TOKEN;
  });

  it('should call next if token is valid', () => {
    req.headers.authorization = 'Bearer test_token_123';
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 401 if authorization header is missing', () => {
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('should return 401 if token is invalid', () => {
    req.headers.authorization = 'Bearer wrong_token';
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 if token is missing in header', () => {
    req.headers.authorization = 'Bearer ';
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
