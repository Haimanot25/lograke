import { test, expect } from '@playwright/test';

test('health endpoint returns 200', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('status', 'healthy');
  expect(body).toHaveProperty('aiEnabled');
});

test('frontend serves index.html', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeAttached();
  await expect(page.locator('title')).toContainText('Lograke');
});

test('CORS headers are set', async ({ request }) => {
  const res = await request.get('/api/health', { headers: { origin: 'http://localhost:5000' } });
  expect(res.headers()).toHaveProperty('access-control-allow-origin');
});

test('404 returns JSON for API routes', async ({ request }) => {
  const res = await request.get('/api/nonexistent-route');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('application/json');
});