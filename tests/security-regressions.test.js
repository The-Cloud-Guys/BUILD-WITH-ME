const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('authentication routes do not log cookies or duplicate refresh', () => {
  const middleware = read('src/middleware/auth.middleware.js');
  const routes = read('src/routes/auth.routes.js');
  assert.doesNotMatch(middleware, /Cookies received|logCookies/);
  assert.equal((routes.match(/router\.post\('\/refresh-token'/g) || []).length, 1);
});

test('sensitive authentication endpoints are rate limited', () => {
  const routes = read('src/routes/auth.routes.js');
  for (const route of [
    'register',
    'verify-email',
    'resend-verification',
    'resend-reset-otp',
    'login',
    'forgot-password',
    'verify-reset-otp',
    'reset-password',
    'firebase',
  ]) {
    assert.match(routes, new RegExp(`router\\.post\\('/${route}', authLimiter,`));
  }
});

test('socket room events retain membership authorization', () => {
  const socket = read('src/socket/index.js');
  for (const event of [
    'join-room',
    'send-message',
    'typing',
    'call-initiate',
    'call-response',
    'leave-call',
    'signal',
  ]) {
    const start = socket.indexOf(`socket.on('${event}'`);
    assert.notEqual(start, -1, `missing ${event}`);
    const next = socket.indexOf("socket.on('", start + 12);
    const handler = socket.slice(start, next === -1 ? socket.length : next);
    assert.match(handler, /isRoomMember/);
  }
});

test('CV upload accepts common Windows/Postman MIME aliases and rejects as HTTP 400', () => {
  const projects = read('src/controllers/project.controller.js');
  assert.match(projects, /'\.pdf': \['application\/pdf', 'application\/octet-stream'\]/);
  assert.match(projects, /'application\/x-zip-compressed'/);
  assert.match(projects, /'\.txt': \['text\/plain', 'application\/octet-stream'\]/);
  assert.match(projects, /error\.statusCode = 400/);
  assert.match(
    projects,
    /'\.docx': 'application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document'/
  );
  assert.match(projects, /getCvStorageContentType\(req\.file\.originalname\)/);
});
