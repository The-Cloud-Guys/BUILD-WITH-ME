const Application = require('../models/application.model');

const roleKey = (projectId, userId) => `${String(projectId)}:${String(userId)}`;

const buildProjectMemberRoleMap = (applications = []) => new Map(
  applications
    .filter((application) => application?.project && application?.applicant)
    .map((application) => [
      roleKey(application.project, application.applicant),
      application.role,
    ])
);

const loadAcceptedProjectRoleMap = async (
  projectIds,
  ApplicationModel = Application
) => {
  const ids = [...new Set((projectIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return new Map();

  const applications = await ApplicationModel.find({
    project: { $in: ids },
    status: 'ACCEPTED',
  })
    .select('project applicant role')
    .lean();

  return buildProjectMemberRoleMap(applications);
};

const attachAppliedProjectRoles = (projectId, members = [], roleMap) =>
  members.map((member) => ({
    ...member,
    role: roleMap.get(roleKey(projectId, member._id)) || null,
  }));

module.exports = {
  roleKey,
  buildProjectMemberRoleMap,
  loadAcceptedProjectRoleMap,
  attachAppliedProjectRoles,
};
