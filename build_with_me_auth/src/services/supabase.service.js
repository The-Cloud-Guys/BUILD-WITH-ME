const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
if (!process.env.SUPABASE_URL) {
  console.error('❌ SUPABASE_URL is not defined in environment variables');
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  try {
    console.log(`[uploadFile] Uploading to bucket: ${bucket}, path: ${filePath}`);
    console.log(`[uploadFile] File size: ${fileBuffer.length} bytes`);
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType,
        cacheControl: '3600',
        upsert: true,
      });

    if (error) {
      console.error(`[uploadFile] Supabase upload error:`, error);
      throw new Error(`Upload failed: ${error.message}`);
    }

    console.log(`[uploadFile] Upload successful:`, data);
    return filePath;
  } catch (error) {
    console.error(`[uploadFile] Upload failed:`, error.message);
    throw new Error(`Upload failed: ${error.message}`);
  }
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
const getSignedUrl = async (bucket, filePath, expiresIn = 3600) => {
  try {
    console.log(`[getSignedUrl] Generating signed URL for bucket: ${bucket}, path: ${filePath}`);
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn);

    if (error) {
      console.error(`[getSignedUrl] Signed URL error:`, error);
      throw new Error(`Signed URL failed: ${error.message}`);
    }

    return data.signedUrl;
  } catch (error) {
    console.error(`[getSignedUrl] Failed:`, error.message);
    throw new Error(`Signed URL failed: ${error.message}`);
  }
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
  try {
    console.log(`[deleteFile] Deleting from bucket: ${bucket}, path: ${filePath}`);
    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      console.error(`[deleteFile] Delete error:`, error);
    }
  } catch (error) {
    console.error(`[deleteFile] Failed:`, error.message);
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  getSignedUrl,
};