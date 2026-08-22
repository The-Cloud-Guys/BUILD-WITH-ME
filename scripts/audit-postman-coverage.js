const fs = require('fs');

const routeModules = {
  'src/routes/auth.routes.js': '/api/auth',
  'src/routes/onboarding.routes.js': '/api/onboarding',
  'src/routes/profile.routes.js': '/api/profile',
  'src/routes/project.routes.js': '/api/projects',
  'src/routes/application.routes.js': '/api/applications',
  'src/routes/notification.routes.js': '/api/notifications',
  'src/routes/community.routes.js': '/api/community',
  'src/routes/chat.routes.js': '/api/chat',
  'src/routes/admin.routes.js': '/api/admin',
};

const normalizePath = (value) => {
  let path = value.replace(/^\{\{baseUrl\}\}/, '');
  try {
    path = new URL(path).pathname;
  } catch (_) {
    path = path.split('?')[0];
  }
  return (`/${path}`).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
};

const pathsMatch = (expected, actual) => {
  const expectedParts = normalizePath(expected).split('/');
  const actualParts = normalizePath(actual).split('/');
  if (expectedParts.length !== actualParts.length) return false;
  return expectedParts.every((part, index) => {
    const candidate = actualParts[index];
    return (
      part === candidate ||
      part.startsWith(':') ||
      /^\{\{[^}]+\}\}$/.test(candidate)
    );
  });
};

const getRoutes = () => {
  const routes = [{ method: 'GET', path: '/' }];
  const pattern = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  for (const [file, prefix] of Object.entries(routeModules)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      routes.push({
        method: match[1].toUpperCase(),
        path: normalizePath(`${prefix}/${match[2]}`),
      });
    }
  }
  return routes;
};

const getPostmanRequests = () => {
  const collection = JSON.parse(
    fs.readFileSync('build_with_me_auth.postman_collection.json', 'utf8')
  );
  const requests = [];

  const visit = (items, parents = []) => {
    for (const item of items || []) {
      if (item.request) {
        const raw = typeof item.request.url === 'string'
          ? item.request.url
          : item.request.url?.raw || '';
        const scripts = (item.event || [])
          .filter((event) => event.listen === 'test')
          .flatMap((event) => event.script?.exec || []);
        requests.push({
          name: [...parents, item.name].join(' / '),
          method: item.request.method,
          path: normalizePath(raw),
          testScript: scripts.join('\n'),
        });
      }
      if (item.item) visit(item.item, [...parents, item.name]);
    }
  };

  visit(collection.item);
  return requests;
};

const auditCoverage = () => {
  const routes = getRoutes();
  const requests = getPostmanRequests();
  const missing = routes.filter(
    (route) =>
      !requests.some(
        (request) =>
          request.method === route.method && pathsMatch(route.path, request.path)
      )
  );
  const untested = requests.filter(
    (request) => !request.testScript.includes('pm.test(')
  );
  return { routes, requests, missing, untested };
};

if (require.main === module) {
  const result = auditCoverage();
  console.log(`Express endpoints discovered: ${result.routes.length}`);
  console.log(`Postman requests discovered: ${result.requests.length}`);
  if (result.missing.length) {
    console.log('Missing Postman endpoint coverage:');
    for (const route of result.missing) {
      console.log(`- ${route.method} ${route.path}`);
    }
  }
  if (result.untested.length) {
    console.log('Postman requests without test scripts:');
    for (const request of result.untested) console.log(`- ${request.name}`);
  }
  if (result.missing.length || result.untested.length) process.exitCode = 1;
  else console.log('Postman endpoint and test-script coverage passed.');
}

module.exports = { auditCoverage, getRoutes, getPostmanRequests, pathsMatch };
