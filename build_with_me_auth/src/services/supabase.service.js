const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ==============================
// UPLOAD FILE (RETURN PATH ONLY)
// ==============================
/**
 * Upload a file to Supabase Storage
 * @param {string} bucket - Bucket name (e.g., 'avatars')
 * @param {string} filePath - Path inside bucket (e.g., 'users/user123/photo.jpg')
 * @param {Buffer} fileBuffer - File data
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} filePath
 */
const uploadFile = async (bucket, filePath, fileBuffer, contentType) => {
  const { error } = await supabase.storage.from(bucket).upload(filePath, fileBuffer, {
    contentType,
    cacheControl: '3600',
    upsert: true,
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return filePath; // Return only the path (not a public URL)
};

// ==============================
// GET SIGNED URL (PRIVATE BUCKET SUPPORT)
// ==============================
/**
 * Generate a signed URL for private Supabase files
 * @param {string} bucket - Bucket name
 * @param {string} filePath - File path in bucket
 * @param {number} expiresIn - Expiry time in seconds (default: 3600)
 * @returns {Promise<string>} signed URL
 */
const getSignedUrl = async (bucket, filePath, expiresIn = 86400) => {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresIn);
  if (error) {
    throw new Error(`Signed URL failed: ${error.message}`);
  }
  return data.signedUrl;
};

// ==============================
// DELETE FILE
// ==============================
/**
 * Delete a file from Supabase Storage
 * @param {string} bucket
 * @param {string} filePath
 */
const deleteFile = async (bucket, filePath) => {
  const { error } = await supabase.storage.from(bucket).remove([filePath]);
  if (error) {
    console.error(`Delete failed: ${error.message}`);
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  getSignedUrl,
};