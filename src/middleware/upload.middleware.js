const multer = require('multer');
const path = require('path');

// Memory storage (no disk write)
const storage = multer.memoryStorage();

// File filter - only images
const fileFilter = (req, file, cb) => {
  // ✅ Allow all image types including jpg, jpeg, png, gif, webp
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  console.log('📸 File upload debug:');
  console.log('   Original name:', file.originalname);
  console.log('   MIME type:', file.mimetype);
  console.log('   Extname check:', extname);
  console.log('   Mimetype check:', mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  }
  
  cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

module.exports = { upload };