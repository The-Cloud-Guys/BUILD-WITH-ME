const Joi = require('joi');

const roleValidation = (data) => {
  const schema = Joi.object({
    role: Joi.string().valid('Developer', 'Designer', 'Product Manager', 'Security', 'Data/ML', 'DevOps', 'Mobile Dev', 'Other').required(),
  });
  return schema.validate(data);
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
  roleValidation,
  skillsValidation,
  profileCompletionValidation,
};