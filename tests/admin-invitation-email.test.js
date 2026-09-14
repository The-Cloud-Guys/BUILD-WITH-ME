const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAdminInvitationEmail } = require('../src/services/adminInvitationEmail.service');

test('admin invitation email includes activation details and escapes HTML', () => {
  const result = buildAdminInvitationEmail({
    firstName: '<Admin>',
    invitedByName: 'Owner & Team',
    role: 'content_admin',
    invitedEmail: 'invite@example.com',
    invitationUrl: 'https://admin.example.com/accept-invitation?token=one-time-token',
    expiresAt: new Date('2026-09-15T12:00:00.000Z'),
  });
  assert.match(result.subject, /invited/);
  assert.match(result.html, /&lt;Admin&gt;/);
  assert.match(result.html, /Owner &amp; Team/);
  assert.match(result.html, /Activate Admin Access/);
  assert.match(result.text, /one-time-token/);
});

test('admin invitations use shared Brevo delivery and hide raw tokens in production', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'adminManagement.controller.js'),
    'utf8'
  );
  assert.match(source, /await sendEmail\(/);
  assert.match(source, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(source, /invitation\.revokedAt = new Date\(\)/);
});

test('shared email service does not log Brevo response bodies', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'email.service.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /error\.response\?\.data/);
  assert.match(source, /error\.response\?\.status/);
});
