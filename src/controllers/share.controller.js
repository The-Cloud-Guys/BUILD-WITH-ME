const { resolveShareResource } = require('../services/shareResource.service');

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const resourceLabels = {
  post: 'post',
  comment: 'comment',
  profile: 'profile',
  project: 'project',
};

const renderFallbackPage = ({ title, description, canonicalPath, noIndex = false }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${noIndex ? '<meta name="robots" content="noindex">' : ''}
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalPath)}">
  <meta name="twitter:card" content="summary">
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p>Open this link on a device with Connexd installed. If sign-in is required, return to the same link afterward to reach the shared content.</p>
  </main>
</body>
</html>`;

const getSharedResource = async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const result = await resolveShareResource({
      resourceType: req.params.resourceType,
      resourceId: req.params.resourceId,
      commentId: req.query.comment,
    });

    if (result.status !== 200) {
      const invalid = result.status === 400;
      return res.status(result.status).type('html').send(renderFallbackPage({
        title: invalid ? 'Invalid Connexd link' : 'Content unavailable',
        description: invalid
          ? 'This shared link is malformed.'
          : 'This content does not exist, was removed, or is not available for sharing.',
        canonicalPath: `${requestOrigin}${req.originalUrl}`,
        noIndex: true,
      }));
    }

    const label = resourceLabels[result.resourceType];
    return res.status(200).type('html').send(renderFallbackPage({
      title: `Open this Connexd ${label}`,
      description: `A Connexd ${label} was shared with you. Open Connexd to view the specific content.`,
      canonicalPath: `${requestOrigin}${result.canonicalPath || req.originalUrl}`,
    }));
  } catch (error) {
    console.error('Share fallback error:', error.message);
    return res.status(503).type('html').send(renderFallbackPage({
      title: 'Connexd is temporarily unavailable',
      description: 'Please try this shared link again shortly.',
      canonicalPath: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      noIndex: true,
    }));
  }
};

module.exports = {
  escapeHtml,
  renderFallbackPage,
  getSharedResource,
};
