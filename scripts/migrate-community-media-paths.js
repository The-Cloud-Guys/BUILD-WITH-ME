const mongoose = require('mongoose');
const Post = require('../src/models/post.model');

const extractStoragePath = (value, bucket) => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;

  try {
    const url = new URL(value);
    const markers = [
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/public/${bucket}/`,
    ];
    const marker = markers.find((candidate) => url.pathname.includes(candidate));
    if (!marker) return null;
    const encodedPath = url.pathname.split(marker)[1];
    return encodedPath ? decodeURIComponent(encodedPath) : null;
  } catch (_) {
    return null;
  }
};

const normalizeMedia = (media, bucket) => {
  let convertible = 0;
  let unresolved = 0;
  const normalized = media.map((value) => {
    if (!/^https?:\/\//i.test(value)) return value;
    const path = extractStoragePath(value, bucket);
    if (!path) {
      unresolved += 1;
      return value;
    }
    convertible += 1;
    return path;
  });
  return { normalized, convertible, unresolved };
};

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI must be supplied explicitly; this command does not load .env'
    );
  }
  if (!process.env.SUPABASE_BUCKET_COMMUNITY) {
    throw new Error('SUPABASE_BUCKET_COMMUNITY must be supplied explicitly');
  }

  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);

  const posts = await Post.find({ media: { $elemMatch: { $regex: '^https?://' } } })
    .select('_id media')
    .lean();

  const operations = [];
  let convertibleUrls = 0;
  let unresolvedUrls = 0;

  for (const post of posts) {
    const result = normalizeMedia(
      post.media || [],
      process.env.SUPABASE_BUCKET_COMMUNITY
    );
    convertibleUrls += result.convertible;
    unresolvedUrls += result.unresolved;
    if (result.convertible > 0) {
      operations.push({
        updateOne: {
          filter: { _id: post._id },
          update: { $set: { media: result.normalized } },
        },
      });
    }
  }

  console.log(`Posts containing HTTP media values: ${posts.length}`);
  console.log(`Convertible signed/public storage URLs: ${convertibleUrls}`);
  console.log(`Unresolved external or unrecognized URLs: ${unresolvedUrls}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply after reviewing these counts.');
    return;
  }

  if (operations.length > 0) await Post.bulkWrite(operations, { ordered: false });
  console.log(`Posts migrated: ${operations.length}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Community media migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = { extractStoragePath, normalizeMedia };
