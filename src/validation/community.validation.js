const Joi = require('joi');

const createPostValidation = (data) => {
  const schema = Joi.object({
    postType: Joi.string().valid('text', 'code', 'link', 'poll', 'photo').default('text'),
    content: Joi.string().allow('').max(1000).default(''),
    tags: Joi.array().items(Joi.string().max(30)),
    codeLanguage: Joi.string().trim().max(50),
    codeSnippet: Joi.string().max(20000),
    linkUrl: Joi.string().uri({ scheme: ['http', 'https'] }),
    linkTitle: Joi.string().trim().max(300).allow(''),
    linkDescription: Joi.string().max(1000).allow(''),
    linkPreviewImage: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
    pollQuestion: Joi.string().trim().max(500),
    pollOptions: Joi.array().items(Joi.string().trim().min(1).max(200)).min(2).max(10).unique(),
    pollDurationHours: Joi.number().integer().min(1).max(24 * 30),
    mediaCount: Joi.number().integer().min(0).max(10).default(0),
  }).custom((value, helpers) => {
    if (value.postType === 'text' && !value.content.trim()) {
      return helpers.message({ custom: 'Text posts require content' });
    }
    if (value.postType === 'code' && (!value.codeLanguage || !value.codeSnippet)) {
      return helpers.message({ custom: 'Code posts require codeLanguage and codeSnippet' });
    }
    if (value.postType === 'link' && !value.linkUrl) {
      return helpers.message({ custom: 'Link posts require linkUrl' });
    }
    if (value.postType === 'poll' && (!value.pollQuestion || !value.pollOptions || !value.pollDurationHours)) {
      return helpers.message({ custom: 'Poll posts require pollQuestion, pollOptions, and pollDurationHours' });
    }
    if (value.postType === 'photo' && value.mediaCount < 1) {
      return helpers.message({ custom: 'Photo posts require at least one media file' });
    }
    return value;
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
    reason: Joi.string().trim().min(1).max(500).required(),
    offenseType: Joi.string().valid(
      'spam', 'harassment', 'hate_speech', 'inappropriate_content',
      'misinformation', 'intellectual_property', 'scam', 'violence',
      'privacy', 'other'
    ).default('other'),
    projectId: Joi.string().hex().length(24).allow(null, ''),
  });
  return schema.validate(data);
};

module.exports = {
  createPostValidation,
  updatePostValidation,
  commentValidation,
  reportValidation,
};
