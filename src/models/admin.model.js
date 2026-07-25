const mongoose = require('mongoose');

// Admin Schema
const adminSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'moderator'],
    default: 'admin'
  },
  permissions: [{
    type: String,
    enum: [
      'manage_users',
      'manage_projects',
      'manage_reports',
      'manage_admins',
      'view_analytics',
      'manage_settings',
      'delete_content'
    ]
  }],
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: Date,
  activityLog: [{
    action: String,
    target: String,
    targetId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Report Schema
const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetType: {
    type: String,
    enum: ['project', 'post', 'comment', 'user'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  reason: {
    type: String,
    required: true,
    maxlength: 500
  },
  reportId: {
    type: String,
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending'
  },
  actionTaken: {
    type: String,
    enum: ['none', 'warning', 'suspend', 'delete_content', 'terminate_account'],
    default: 'none'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  resolution: String,
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  escalated: {
    type: Boolean,
    default: false
  },
  notes: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Auto-generate report ID
reportSchema.pre('save', async function(next) {
  if (!this.reportId) {
    const count = await this.constructor.countDocuments();
    this.reportId = `RPT-${String(count + 1).padStart(3, '0')}`;
  }
  next();
});

// Audit Log Schema
const auditLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true
  },
  targetType: {
    type: String,
    enum: ['user', 'project', 'report', 'post', 'comment', 'admin'],
    required: true
  },
  targetId: mongoose.Schema.Types.ObjectId,
  details: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String
}, { timestamps: true });

module.exports = {
  Admin: mongoose.model('Admin', adminSchema),
  Report: mongoose.model('Report', reportSchema),
  AuditLog: mongoose.model('AuditLog', auditLogSchema)
};