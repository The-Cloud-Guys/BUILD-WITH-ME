const Joi = require('joi');

const idToken = Joi.string().min(100).max(10000).required();
const invitationToken = Joi.string().min(32).max(512).required();

const adminFirebaseValidation = (data) => Joi.object({ idToken })
  .validate(data, { abortEarly: false, stripUnknown: true });

const bootstrapFirebaseAdminValidation = (data) => Joi.object({
  idToken,
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
}).validate(data, { abortEarly: false, stripUnknown: true });

const invitationTokenValidation = (data) => Joi.object({ token: invitationToken })
  .validate(data, { abortEarly: false, stripUnknown: true });

const acceptFirebaseInvitationValidation = (data) => Joi.object({
  token: invitationToken,
  idToken,
}).validate(data, { abortEarly: false, stripUnknown: true });

module.exports = {
  acceptFirebaseInvitationValidation,
  adminFirebaseValidation,
  bootstrapFirebaseAdminValidation,
  invitationTokenValidation,
};
