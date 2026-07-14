const Joi = require('joi');

const createPostValidation = (data) => {
  const schema = Joi.object({
    content: Joi.string().min(1).max(1000).required(),
    tags: Joi.array().items(Joi.string().max(30)),
  });
  return schema.validate(data);
};

const updatePostValidation = (data) => {
  const schema = Joi.object({
    content: Joi.string().min(1).max(1000),
    tags: Joi.array().items(Joi.string().max(30)),
  });
  return schema.validate(data);
};

const commentValidation = (data) => {
  const schema = Joi.object({
    content: Joi.string().min(1).max(500).required(),
    parentCommentId: Joi.string().optional(),
  });
  return schema.validate(data);
};

const reportValidation = (data) => {
  const schema = Joi.object({
    reason: Joi.string().max(500).optional(),
  });
  return schema.validate(data);
};

module.exports = {
  createPostValidation,
  updatePostValidation,
  commentValidation,
  reportValidation,
};