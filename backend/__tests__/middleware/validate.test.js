const { validateBody, validateQuery } = require('../../src/middleware/validate');

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

describe('validateBody', () => {
  it('should call next() when all required fields are present', () => {
    const middleware = validateBody({
      name: { required: true, type: 'string' },
      age: { required: true, type: 'number' }
    });

    const req = { body: { name: 'Alice', age: 30 } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('should return 400 when required field is missing', () => {
    const middleware = validateBody({
      name: { required: true }
    });

    const req = { body: {} };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toContain('name is required');
  });

  it('should return 400 for wrong type', () => {
    const middleware = validateBody({
      count: { required: true, type: 'number' }
    });

    const req = { body: { count: 'not-a-number' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toContain('count must be of type number');
  });

  it('should enforce minLength', () => {
    const middleware = validateBody({
      password: { required: true, type: 'string', minLength: 8 }
    });

    const req = { body: { password: 'short' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.details[0]).toMatch(/at least 8/);
  });

  it('should enforce maxLength', () => {
    const middleware = validateBody({
      name: { required: true, type: 'string', maxLength: 5 }
    });

    const req = { body: { name: 'toolongname' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
  });

  it('should enforce enum values', () => {
    const middleware = validateBody({
      level: { required: true, enum: ['info', 'warn', 'error'] }
    });

    const req = { body: { level: 'critical' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.details[0]).toMatch(/info, warn, error/);
  });

  it('should enforce min/max for numbers', () => {
    const middleware = validateBody({
      port: { type: 'number', min: 1, max: 65535 }
    });

    const req1 = { body: { port: 0 } };
    const res1 = mockRes();
    middleware(req1, res1, jest.fn());
    expect(res1.statusCode).toBe(400);

    const req2 = { body: { port: 99999 } };
    const res2 = mockRes();
    middleware(req2, res2, jest.fn());
    expect(res2.statusCode).toBe(400);

    const req3 = { body: { port: 3000 } };
    const res3 = mockRes();
    const next3 = jest.fn();
    middleware(req3, res3, next3);
    expect(next3).toHaveBeenCalled();
  });

  it('should skip validation for undefined optional fields', () => {
    const middleware = validateBody({
      optional_field: { type: 'string' }
    });

    const req = { body: {} };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should enforce regex pattern', () => {
    const middleware = validateBody({
      email: { type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
    });

    const req1 = { body: { email: 'not-an-email' } };
    const res1 = mockRes();
    middleware(req1, res1, jest.fn());
    expect(res1.statusCode).toBe(400);

    const req2 = { body: { email: 'valid@example.com' } };
    const res2 = mockRes();
    const next2 = jest.fn();
    middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
  });
});

describe('validateQuery', () => {
  it('should call next() for valid query params', () => {
    const middleware = validateQuery({
      page: { type: 'number', min: 1 },
      level: { enum: ['info', 'warn', 'error'] }
    });

    const req = { query: { page: '1', level: 'info' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(1); // should be coerced to number
  });

  it('should return 400 for non-numeric page', () => {
    const middleware = validateQuery({
      page: { type: 'number' }
    });

    const req = { query: { page: 'abc' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toContain('page must be a number');
  });

  it('should return 400 for invalid enum', () => {
    const middleware = validateQuery({
      sort: { enum: ['asc', 'desc'] }
    });

    const req = { query: { sort: 'random' } };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
  });

  it('should return 400 when required query param is missing', () => {
    const middleware = validateQuery({
      fileId: { required: true }
    });

    const req = { query: {} };
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(res.statusCode).toBe(400);
  });
});
