const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const IMAGE_TYPES = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimeTypes = IMAGE_TYPES[ext];

  if (!allowedMimeTypes || !allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      new Error('Only JPEG, PNG, WEBP, and GIF image files are allowed')
    );
  }

  return cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter,
});

module.exports = { upload };
