const Joi = require('joi');

const {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
} = require('../constants/admin.constants');

const permissions = Joi.array()
  .items(Joi.string().valid(...ADMIN_PERMISSIONS))
  .unique();

const createAdminInvitationValidation = (data) => Joi.object({
  email: Joi.string().email().trim().lowercase().required(),
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  role: Joi.string().valid(...ADMIN_ROLES).default('admin'),
  permissions,
}).validate(data, { abortEarly: false, stripUnknown: true });

const updateAdminValidation = (data) => Joi.object({
  role: Joi.string().valid(...ADMIN_ROLES),
  permissions,
  isActive: Joi.boolean(),
}).min(1).validate(data, { abortEarly: false, stripUnknown: true });

module.exports = {
  createAdminInvitationValidation,
  updateAdminValidation,
};
