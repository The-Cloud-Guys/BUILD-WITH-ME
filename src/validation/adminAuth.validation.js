const Joi = require('joi');

const email = Joi.string().email().trim().lowercase().required();
const password = Joi.string().min(12).max(128).required();

const bootstrapAdminValidation = (data) => Joi.object({
  email,
  password,
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
}).validate(data, { abortEarly: false, stripUnknown: true });

const adminLoginValidation = (data) => Joi.object({
  email,
  password: Joi.string().max(128).required(),
}).validate(data, { abortEarly: false, stripUnknown: true });

const acceptAdminInvitationValidation = (data) => Joi.object({
  token: Joi.string().min(32).max(512).required(),
  password,
}).validate(data, { abortEarly: false, stripUnknown: true });

module.exports = {
  acceptAdminInvitationValidation,
  adminLoginValidation,
  bootstrapAdminValidation,
};
