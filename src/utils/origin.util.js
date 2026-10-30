const DEFAULT_ADMIN_DASHBOARD_URL = 'https://conexd-admin.onrender.com';
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

const normalizeOrigin = (value) => {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\/$/, '') || null;
};

const parseOriginList = (...values) => values
  .flatMap((value) => typeof value === 'string' ? value.split(',') : [])
  .map(normalizeOrigin)
  .filter(Boolean);

const getAdminDashboardOrigins = () => {
  const configured = parseOriginList(
    process.env.ADMIN_DASHBOARD_URL,
    process.env.ADMIN_DASHBOARD_URLS
  );
  return new Set(configured.length ? configured : [DEFAULT_ADMIN_DASHBOARD_URL]);
};

const getCorsAllowedOrigins = () => {
  const frontendOrigins = parseOriginList(process.env.FRONTEND_URL);
  return new Set([
    ...(frontendOrigins.length ? frontendOrigins : [DEFAULT_FRONTEND_URL]),
    ...getAdminDashboardOrigins(),
  ]);
};

module.exports = {
  getAdminDashboardOrigins,
  getCorsAllowedOrigins,
  normalizeOrigin,
  parseOriginList,
};
