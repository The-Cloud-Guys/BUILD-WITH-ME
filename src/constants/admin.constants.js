const ADMIN_ROLES = Object.freeze([
  'super_admin',
  'admin',
  'moderator',
]);

const ADMIN_PERMISSIONS = Object.freeze([
  'manage_users',
  'manage_projects',
  'manage_reports',
  'manage_admins',
  'view_analytics',
  'manage_settings',
  'delete_content',
]);

const DEFAULT_ADMIN_PERMISSIONS = Object.freeze({
  super_admin: ADMIN_PERMISSIONS,
  admin: Object.freeze([
    'manage_users',
    'manage_projects',
    'manage_reports',
    'view_analytics',
    'delete_content',
  ]),
  moderator: Object.freeze([
    'manage_reports',
    'delete_content',
  ]),
});

const ADMIN_AUTH_METHODS = Object.freeze([
  'password',
  'google',
  'microsoft',
]);

module.exports = {
  ADMIN_AUTH_METHODS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  DEFAULT_ADMIN_PERMISSIONS,
};
