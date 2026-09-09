const Joi = require('joi');

const codeSchema = Joi.object({
  code: Joi.string().pattern(/^\d{6}$/).required().messages({
    'string.pattern.base': 'MFA code must contain exactly 6 digits',
  }),
});

const adminMfaCodeValidation = (body) => codeSchema.validate(body, {
  abortEarly: false,
  stripUnknown: true,
});

module.exports = { adminMfaCodeValidation };
