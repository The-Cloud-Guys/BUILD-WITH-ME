const mongoose = require('mongoose');
require('dotenv').config();

console.log('🔍 Testing MongoDB connection...');

mongoose.connect(process.env.MONGODB_URI)
.then(() => {
    console.log('✅ MongoDB Connected Successfully!');
    process.exit(0);
})
.catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
