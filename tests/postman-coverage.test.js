const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { auditCoverage } = require('../scripts/audit-postman-coverage');

test('Postman collection covers every Express endpoint with a test script', () => {
  const result = auditCoverage();
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.untested, []);
});

test('Postman collection maintains workflow variables and bearer auth at collection scope', () => {
  const collection = JSON.parse(
    fs.readFileSync('build_with_me_auth.postman_collection.json', 'utf8')
  );
  const variables = new Set(collection.variable.map(({ key }) => key));
  for (const key of [
    'baseUrl',
    'accessToken',
    'refreshToken',
    'ownerId',
    'applicantId',
    'projectId',
    'applicationId',
    'postId',
    'commentId',
    'notificationId',
    'reportId',
    'roomId',
    'messageId',
  ]) {
    assert.equal(variables.has(key), true, `missing collection variable: ${key}`);
  }

  assert.equal(collection.auth.type, 'bearer');
  assert.equal(collection.auth.bearer[0].value, '{{accessToken}}');
  const preRequest = collection.event
    .find(({ listen }) => listen === 'prerequest')
    .script.exec.join('\n');
  assert.match(preRequest, /pm\.collectionVariables\.toObject\(\)/);
  assert.match(preRequest, /pm\.variables\.set\('baseUrl'/);

  const visit = (items = []) => {
    for (const item of items) {
      if (item.request) {
        assert.equal(
          typeof item.request.url,
          'string',
          `${item.name} must expose its complete URL as a literal string`
        );
        assert.match(
          item.request.url,
          /^\{\{baseUrl\}\}\//,
          `${item.name} must include its endpoint after {{baseUrl}}`
        );
      }
      visit(item.item);
    }
  };
  visit(collection.item);
});

test('Postman authenticates each role once and keeps uploads on their data routes', () => {
  const collection = JSON.parse(
    fs.readFileSync('build_with_me_auth.postman_collection.json', 'utf8')
  );
  const requests = [];
  const visit = (items = []) => {
    for (const item of items) {
      if (item.request) requests.push(item);
      visit(item.item);
    }
  };
  visit(collection.item);

  const successfulLogins = requests.filter(
    ({ name, request }) =>
      request.url === '{{baseUrl}}/api/auth/login' &&
      !name.toLowerCase().includes('invalid')
  );
  assert.deepEqual(
    successfulLogins.map(({ name }) => name),
    [
      '005. Login Applicant Once',
      '006. Login Admin Once',
      '007. Login Owner Once',
    ]
  );

  for (const route of [
    '{{baseUrl}}/api/profile/userProfile',
    '{{baseUrl}}/api/projects/{{projectId}}/apply',
    '{{baseUrl}}/api/community/posts',
  ]) {
    const matching = requests.filter(({ request }) => request.url === route);
    assert.ok(matching.length > 0, `missing multipart route: ${route}`);
    for (const { request } of matching) {
      assert.equal(request.body?.mode, 'formdata', `${route} must use multipart form-data`);
    }
  }

  const applicationUpload = requests
    .find(({ name }) => name.includes('Apply to Project (multipart'))
    .request.body.formdata.find(({ key }) => key === 'cv');
  assert.equal(applicationUpload.type, 'file');
  assert.notEqual(applicationUpload.disabled, true);
  assert.match(applicationUpload.description, /PDF, DOC, DOCX, or TXT/);

  assert.equal(
    requests.some(({ request }) => request.url === '{{baseUrl}}/api/profile/me/photo' && request.method === 'POST'),
    false
  );
});

test('Postman follows journey order with continuous numbering and no enhanced route', () => {
  const collection = JSON.parse(
    fs.readFileSync('build_with_me_auth.postman_collection.json', 'utf8')
  );
  const requests = collection.item.flatMap((folder) => folder.item || []);
  requests.forEach((request, index) => {
    assert.match(
      request.name,
      new RegExp(`^${String(index + 1).padStart(3, '0')}\\.`),
      `request ${index + 1} is not sequentially numbered`
    );
  });

  assert.deepEqual(
    collection.item.slice(0, 4).map(({ name }) => name),
    ['00 - System', '01 - Authentication', '02 - Onboarding', '03 - Profile']
  );
  assert.equal(
    requests.some(({ request }) => request.url.includes('/enhanced')),
    false
  );

  const authenticationUrls = collection.item[1].item.map(({ request }) => request.url);
  assert.deepEqual(authenticationUrls, [
    '{{baseUrl}}/api/auth/register',
    '{{baseUrl}}/api/auth/resend-verification',
    '{{baseUrl}}/api/auth/verify-email',
    '{{baseUrl}}/api/auth/login',
    '{{baseUrl}}/api/auth/login',
    '{{baseUrl}}/api/auth/login',
    '{{baseUrl}}/api/auth/forgot-password',
    '{{baseUrl}}/api/auth/resend-reset-otp',
    '{{baseUrl}}/api/auth/verify-reset-otp',
    '{{baseUrl}}/api/auth/reset-password',
    '{{baseUrl}}/api/auth/firebase',
    '{{baseUrl}}/api/auth/me',
    '{{baseUrl}}/api/auth/refresh-token',
    '{{baseUrl}}/api/auth/refresh-token',
  ]);
});

test('Postman globally rejects server errors, stack traces, and storage MIME regressions', () => {
  const collection = JSON.parse(
    fs.readFileSync('build_with_me_auth.postman_collection.json', 'utf8')
  );
  const globalTests = collection.event
    .find(({ listen }) => listen === 'test')
    .script.exec.join('\n');
  assert.match(globalTests, /response\.code.*below\(500\)/s);
  assert.match(globalTests, /API response is JSON/);
  assert.match(globalTests, /server stack trace/);
  assert.match(globalTests, /mime type application\/octet-stream is not supported/);
});
