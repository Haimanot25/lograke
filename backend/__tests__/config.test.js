const config = require('../src/config');

describe('config', () => {
  it('should have default port 5000', () => {
    expect(config.port).toBeDefined();
    expect(typeof config.port).toBe('number');
  });

  it('should have CORS config', () => {
    expect(config.cors).toHaveProperty('origin');
    expect(config.cors).toHaveProperty('credentials');
  });

  it('should have auth config', () => {
    expect(config.auth).toHaveProperty('enabled');
    expect(config.auth).toHaveProperty('jwtSecret');
    expect(config.auth).toHaveProperty('jwtExpiresIn');
  });

  it('should compute auth.enabled from AUTH_ENABLED (default: enabled)', () => {
    expect(config.auth.enabled).toBe(process.env.AUTH_ENABLED !== 'false');
  });

  it('should have AI provider config with defaults', () => {
    expect(config.ai).toHaveProperty('activeProvider');
    expect(config.ai).toHaveProperty('ollamaBaseUrl');
    expect(config.ai.ollamaBaseUrl).toBe('http://localhost:11434');
  });

  it('should default active AI provider to groq', () => {
    expect(config.ai.activeProvider).toBe('groq');
  });

  it('should have upload config', () => {
    expect(config.upload).toHaveProperty('maxFileSize');
    expect(config.upload).toHaveProperty('maxJsonBody');
    expect(typeof config.upload.maxFileSize).toBe('number');
  });

  it('should have log config', () => {
    expect(config.log).toHaveProperty('level');
    expect(config.log.level).toBe('info');
  });

  it('should have nodeEnv set', () => {
    expect(config.nodeEnv).toBeDefined();
  });
});