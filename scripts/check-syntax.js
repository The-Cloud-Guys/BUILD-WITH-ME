const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['src', 'scripts', 'tests'];
const files = [];

const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.isFile() && target.endsWith('.js')) files.push(target);
  }
};

for (const root of roots) {
  if (fs.existsSync(root)) visit(root);
}

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exitCode = 1;
else console.log(`Syntax check passed for ${files.length} JavaScript files.`);
