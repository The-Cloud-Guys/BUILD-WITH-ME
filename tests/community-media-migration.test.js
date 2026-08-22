const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractStoragePath,
  normalizeMedia,
} = require('../scripts/migrate-community-media-paths');

test('extracts stable paths from Supabase signed URLs without retaining tokens', () => {
  const value =
    'https://example.supabase.co/storage/v1/object/sign/community/posts%2Fu1%2Fp1.jpg?token=redacted';
  assert.equal(
    extractStoragePath(value, 'community'),
    'posts/u1/p1.jpg'
  );
});

test('migration preserves stable paths and reports unrecognized external URLs', () => {
  const result = normalizeMedia(
    [
      'posts/u1/already-stable.jpg',
      'https://example.supabase.co/storage/v1/object/public/community/posts/u1/public.jpg',
      'https://cdn.example.com/external.jpg',
    ],
    'community'
  );
  assert.deepEqual(result.normalized, [
    'posts/u1/already-stable.jpg',
    'posts/u1/public.jpg',
    'https://cdn.example.com/external.jpg',
  ]);
  assert.equal(result.convertible, 1);
  assert.equal(result.unresolved, 1);
});
