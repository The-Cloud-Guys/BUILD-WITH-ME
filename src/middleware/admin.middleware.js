const { Admin } = require('../models/admin.model');

const isAdmin = async (req, res, next) => {
  try {
    const admin = await Admin.findOne({ 
      user: req.user.id, 
      isActive: true 
    });
    
    if (!admin) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    req.admin = admin;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const isSuperAdmin = async (req, res, next) => {
  try {
    const admin = await Admin.findOne({ 
      user: req.user.id, 
      isActive: true,
      role: 'super_admin'
    });
    
    if (!admin) {
      return res.status(403).json({ message: 'Super admin access required' });
    }
    
    req.admin = admin;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { isAdmin, isSuperAdmin };