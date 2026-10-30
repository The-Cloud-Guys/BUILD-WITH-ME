const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAdminDashboardOrigins,
  getCorsAllowedOrigins,
  parseOriginList,
} = require('../src/utils/origin.util');

test('origin lists are comma-separated, trimmed, normalized, and deduplicated by Set consumers', () => {
  assert.deepEqual(
    parseOriginList(' https://admin.example.com/, http://localhost:3000 ', ''),
    ['https://admin.example.com', 'http://localhost:3000']
  );
});

test('admin origins combine singular and plural environment settings', () => {
  const previous = process.env.ADMIN_DASHBOARD_URL;
  const previousList = process.env.ADMIN_DASHBOARD_URLS;
  process.env.ADMIN_DASHBOARD_URL = 'https://admin.example.com';
  process.env.ADMIN_DASHBOARD_URLS = 'http://localhost:3000,http://localhost:5173';
  try {
    assert.deepEqual([...getAdminDashboardOrigins()], [
      'https://admin.example.com',
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_DASHBOARD_URL;
    else process.env.ADMIN_DASHBOARD_URL = previous;
    if (previousList === undefined) delete process.env.ADMIN_DASHBOARD_URLS;
    else process.env.ADMIN_DASHBOARD_URLS = previousList;
  }
});

test('global CORS origins contain frontend and every admin dashboard origin', () => {
  const previousFrontend = process.env.FRONTEND_URL;
  const previousAdmin = process.env.ADMIN_DASHBOARD_URL;
  const previousAdminList = process.env.ADMIN_DASHBOARD_URLS;
  process.env.FRONTEND_URL = 'https://app.example.com';
  process.env.ADMIN_DASHBOARD_URL = 'https://admin.example.com';
  process.env.ADMIN_DASHBOARD_URLS = 'http://localhost:3000';
  try {
    assert.deepEqual([...getCorsAllowedOrigins()], [
      'https://app.example.com',
      'https://admin.example.com',
      'http://localhost:3000',
    ]);
  } finally {
    if (previousFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontend;
    if (previousAdmin === undefined) delete process.env.ADMIN_DASHBOARD_URL;
    else process.env.ADMIN_DASHBOARD_URL = previousAdmin;
    if (previousAdminList === undefined) delete process.env.ADMIN_DASHBOARD_URLS;
    else process.env.ADMIN_DASHBOARD_URLS = previousAdminList;
  }
});
