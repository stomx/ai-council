const yaml = require('yaml');

console.log('Running tests...');

try {
  yaml.parse('test: value');
  console.log('YAML test passed.');
} catch (e) {
  console.error('YAML test failed:', e);
  process.exit(1);
}

process.exit(0);