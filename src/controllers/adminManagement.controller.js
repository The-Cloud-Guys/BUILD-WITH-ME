const crypto = require('crypto');
const mongoose = require('mongoose');

const AdminAccount = require('../models/adminAccount.model');
const AdminInvite = require('../models/adminInvite.model');
const AdminSession = require('../models/adminSession.model');
const { AuditLog } = require('../models/admin.model');
const { DEFAULT_ADMIN_PERMISSIONS } = require('../constants/admin.constants');
const { getDurationMs } = require('../services/adminAuth.service');
const { hashInvitationToken } = require('../services/adminInvitation.service');
const {
  createAdminInvitationValidation,
  updateAdminValidation,
} = require('../validation/adminManagement.validation');

const serializeManagedAdmin = (admin) => ({
  _id: admin._id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
  fullName: admin.fullName,
  role: admin.role,
  permissions: admin.permissions,
  authMethods: admin.authMethods,
  isActive: admin.isActive,
  migrationPending: admin.migrationPending,
  mfaEnabled: admin.mfaEnabled,
  lastLoginAt: admin.lastLoginAt,
  createdAt: admin.createdAt,
});

const mayGrant = (requester, role, permissions) => {
  if (requester.role === 'super_admin') return true;
  if (role === 'super_admin') return false;
  return permissions.every((permission) => requester.permissions.includes(permission));
};

const getDedicatedAdmins = async (_req, res) => {
  try {
    const admins = await AdminAccount.find()
      .populate('addedBy', 'firstName lastName email role')
      .sort('-createdAt');
    return res.json({ admins: admins.map(serializeManagedAdmin) });
  } catch (error) {
    console.error('Get dedicated admins failed:', error.message);
    return res.status(500).json({ message: 'Unable to retrieve administrators' });
  }
};

const createAdminInvitation = async (req, res) => {
  try {
    const { error, value } = createAdminInvitationValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const permissions = value.permissions || DEFAULT_ADMIN_PERMISSIONS[value.role];
    if (!mayGrant(req.adminAccount, value.role, permissions)) {
      return res.status(403).json({ message: 'Cannot grant privileges you do not hold' });
    }

    const existingAdmin = await AdminAccount.findOne({ email: value.email });
    if (existingAdmin && !existingAdmin.migrationPending) {
      return res.status(409).json({ message: 'An administrator with this email already exists' });
    }

    await AdminInvite.updateMany(
      { email: value.email, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + getDurationMs(process.env.ADMIN_INVITE_EXPIRES_IN, '24h')
    );
    const invitation = await AdminInvite.create({
      email: value.email,
      firstName: value.firstName,
      lastName: value.lastName,
      role: value.role,
      permissions,
      tokenHash: hashInvitationToken(token),
      invitedBy: req.adminAccount._id,
      existingAdmin: existingAdmin?._id || null,
      expiresAt,
    });

    await AuditLog.create({
      adminAccount: req.adminAccount._id,
      action: 'invite_admin',
      targetType: 'admin',
      targetId: existingAdmin?._id || invitation._id,
      details: { email: value.email, role: value.role, permissions },
    });

    const dashboardUrl = process.env.ADMIN_DASHBOARD_URL?.replace(/\/$/, '');
    return res.status(201).json({
      message: 'Admin invitation created successfully',
      invitation: {
        _id: invitation._id,
        email: invitation.email,
        role: invitation.role,
        permissions: invitation.permissions,
        expiresAt: invitation.expiresAt,
        token,
        acceptUrl: dashboardUrl
          ? `${dashboardUrl}/accept-invitation?token=${encodeURIComponent(token)}`
          : null,
      },
    });
  } catch (error) {
    console.error('Create admin invitation failed:', error.message);
    return res.status(500).json({ message: 'Unable to create admin invitation' });
  }
};

const getAdminInvitations = async (_req, res) => {
  try {
    const invitations = await AdminInvite.find()
      .populate('invitedBy', 'firstName lastName email role')
      .sort('-createdAt')
      .lean();
    return res.json({ invitations });
  } catch (error) {
    console.error('Get admin invitations failed:', error.message);
    return res.status(500).json({ message: 'Unable to retrieve admin invitations' });
  }
};

const revokeAdminInvitation = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.inviteId)) {
      return res.status(400).json({ message: 'Invalid admin invitation ID' });
    }
    const invitation = await AdminInvite.findOneAndUpdate(
      { _id: req.params.inviteId, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { new: true }
    );
    if (!invitation) {
      return res.status(404).json({ message: 'Active admin invitation not found' });
    }

    await AuditLog.create({
      adminAccount: req.adminAccount._id,
      action: 'revoke_admin_invitation',
      targetType: 'admin',
      targetId: invitation._id,
      details: { email: invitation.email },
    });
    return res.json({ message: 'Admin invitation revoked successfully' });
  } catch (error) {
    console.error('Revoke admin invitation failed:', error.message);
    return res.status(500).json({ message: 'Unable to revoke admin invitation' });
  }
};

const updateDedicatedAdmin = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.adminId)) {
      return res.status(400).json({ message: 'Invalid administrator ID' });
    }
    const { error, value } = updateAdminValidation(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const target = await AdminAccount.findById(req.params.adminId);
    if (!target) return res.status(404).json({ message: 'Administrator not found' });
    if (target._id.equals(req.adminAccount._id)) {
      return res.status(400).json({ message: 'You cannot change your own access' });
    }

    const nextRole = value.role || target.role;
    const nextPermissions = value.permissions || target.permissions;
    if (!mayGrant(req.adminAccount, nextRole, nextPermissions)) {
      return res.status(403).json({ message: 'Cannot grant privileges you do not hold' });
    }

    const removesSuperAdmin = target.role === 'super_admin' && (
      nextRole !== 'super_admin' || value.isActive === false
    );
    if (removesSuperAdmin) {
      const activeSuperAdmins = await AdminAccount.countDocuments({
        role: 'super_admin',
        isActive: true,
      });
      if (activeSuperAdmins <= 1) {
        return res.status(400).json({ message: 'Cannot remove the last active super admin' });
      }
    }

    if (value.role !== undefined) target.role = value.role;
    if (value.permissions !== undefined) target.permissions = value.permissions;
    if (value.isActive !== undefined) target.isActive = value.isActive;
    target.tokenVersion += 1;
    await target.save();
    await AdminSession.updateMany(
      { admin: target._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    await AuditLog.create({
      adminAccount: req.adminAccount._id,
      action: 'update_admin_access',
      targetType: 'admin',
      targetId: target._id,
      details: value,
    });
    return res.json({
      message: 'Administrator access updated successfully',
      admin: serializeManagedAdmin(target),
    });
  } catch (error) {
    console.error('Update dedicated admin failed:', error.message);
    return res.status(500).json({ message: 'Unable to update administrator' });
  }
};

const deactivateDedicatedAdmin = async (req, res) => {
  req.body = { isActive: false };
  return updateDedicatedAdmin(req, res);
};

module.exports = {
  createAdminInvitation,
  deactivateDedicatedAdmin,
  getAdminInvitations,
  getDedicatedAdmins,
  mayGrant,
  revokeAdminInvitation,
  serializeManagedAdmin,
  updateDedicatedAdmin,
};
