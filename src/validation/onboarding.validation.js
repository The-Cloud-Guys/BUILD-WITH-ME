const Joi = require('joi');

const ALLOWED_ROLES = [
  'Developer',
  'Designer',
  'Product Manager',
  'Security',
  'Data/ML',
  'DevOps',
  'Mobile Dev',
  'Other',
];

const normalizeSkillsInput = (skills) => {
  if (skills === undefined) return undefined;

  const values = Array.isArray(skills) ? skills : [skills];
  const normalized = values.flatMap((value) => {
    if (typeof value !== 'string') return [value];
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fall back to comma-separated multipart text below.
      }
    }

    return trimmed.split(',');
  });

  return [...new Set(
    normalized
      .map((skill) => String(skill).trim())
      .filter(Boolean)
  )];
};

const roleValidation = (data) => {
  const schema = Joi.object({
    role: Joi.string().valid(...ALLOWED_ROLES).required(),
  });
  return schema.validate(data);
};

const combinedProfileValidation = (data, { partial = false } = {}) => {
  const required = (schema) => partial ? schema.optional() : schema.required();
  const schema = Joi.object({
    firstName: required(Joi.string().trim().min(1).max(50)),
    lastName: required(Joi.string().trim().min(1).max(50)),
    role: required(Joi.string().trim().valid(...ALLOWED_ROLES)),
    skills: required(Joi.array().items(Joi.string().trim().min(1).max(100)).min(1)),
    bio: Joi.string().max(500).allow('', null),
    externalLink: Joi.string().uri().allow('', null),
  });

  return schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });
};

const skillsValidation = (data) => {
  const schema = Joi.object({
    skills: Joi.array().items(Joi.string()).min(1).required(),
  });
  return schema.validate(data);
};

const profileCompletionValidation = (data) => {
  const schema = Joi.object({
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).required(),
    bio: Joi.string().max(500).allow('', null),
    externalLink: Joi.string().uri().allow('', null),
  });
  return schema.validate(data);
};

module.exports = {
  ALLOWED_ROLES,
  normalizeSkillsInput,
  combinedProfileValidation,
  roleValidation,
  skillsValidation,
  profileCompletionValidation,
};
