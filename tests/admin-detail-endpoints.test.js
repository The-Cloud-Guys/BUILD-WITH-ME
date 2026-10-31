const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin project and report detail routes use their existing management permissions', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js'),
    'utf8'
  );
  assert.match(source, /router\.get\('\/projects\/:projectId', requireAdminPermission\('manage_projects'\), getAdminProjectDetails\)/);
  assert.match(source, /router\.get\('\/reports\/:reportId', requireAdminPermission\('manage_reports'\), getAdminReportDetails\)/);
});

test('admin project details expose role, application, metadata, and moderation context', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'admin.controller.js'),
    'utf8'
  );
  assert.match(source, /const getAdminProjectDetails/);
  assert.match(source, /attachAppliedProjectRoles/);
  assert.match(source, /openRoleSlots/);
  assert.match(source, /applicationCounts/);
  assert.match(source, /moderation:/);
  assert.match(source, /resolveProfilePhotos\(details\)/);
});

test('admin report details accept database or case IDs and expose the reported target', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'admin.controller.js'),
    'utf8'
  );
  assert.match(source, /const getAdminReportDetails/);
  assert.match(source, /const getReportIdentifierFilter/);
  assert.match(source, /\^RPT-\[A-Z0-9\]\+\$/);
  assert.match(source, /reportedContent: target/);
  assert.match(source, /evidenceCount: 0/);
  assert.match(source, /relatedProject/);
  assert.match(source, /Report\.findOne\(reportFilter\)/);
});
