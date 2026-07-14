const supabase = require('../utils/supabase');
const uploadFile = async (bucket, filePath, fileBuffer, contentType) => {
  const { data, error } = await supabase.storage.from(bucket).upload(filePath, fileBuffer, { contentType });
  if (error) throw error;
  return data;
};
module.exports = { uploadFile };