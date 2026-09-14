const getDurationMs = (rawValue, fallback) => {
  const value = typeof rawValue === 'string' && rawValue.trim()
    ? rawValue.trim()
    : fallback;
  const match = /^(\d+)\s*([smhd])$/i.exec(value);
  if (!match) return getDurationMs(fallback, '12h');
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Number(match[1]) * units[match[2].toLowerCase()];
};

module.exports = { getDurationMs };
