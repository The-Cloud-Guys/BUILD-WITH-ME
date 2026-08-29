const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectMemberRoleMap,
  loadAcceptedProjectRoleMap,
  attachAppliedProjectRoles,
} = require('../src/services/projectMemberRole.service');

test('team member role comes from the accepted project application', () => {
  const roleMap = buildProjectMemberRoleMap([
    {
      project: 'project-1',
      applicant: 'user-1',
      role: 'Mobile Developer',
    },
  ]);
  const [member] = attachAppliedProjectRoles(
    'project-1',
    [{ _id: 'user-1', firstName: 'Ada', role: 'Designer' }],
    roleMap
  );

  assert.equal(member.role, 'Mobile Developer');
  assert.equal(member.firstName, 'Ada');
});

test('legacy team member without an accepted application does not expose onboarding role', () => {
  const [member] = attachAppliedProjectRoles(
    'project-1',
    [{ _id: 'user-1', role: 'Global Onboarding Role' }],
    new Map()
  );
  assert.equal(member.role, null);
});

test('roles remain scoped to both project and member', () => {
  const roleMap = buildProjectMemberRoleMap([
    { project: 'project-1', applicant: 'user-1', role: 'Backend Developer' },
    { project: 'project-2', applicant: 'user-1', role: 'Technical Writer' },
  ]);

  assert.equal(
    attachAppliedProjectRoles('project-1', [{ _id: 'user-1' }], roleMap)[0].role,
    'Backend Developer'
  );
  assert.equal(
    attachAppliedProjectRoles('project-2', [{ _id: 'user-1' }], roleMap)[0].role,
    'Technical Writer'
  );
});

test('role loader requests accepted applications only', async () => {
  let receivedFilter;
  const ApplicationModel = {
    find(filter) {
      receivedFilter = filter;
      return {
        select() {
          return {
            async lean() {
              return [
                { project: 'project-1', applicant: 'user-1', role: 'QA Engineer' },
              ];
            },
          };
        },
      };
    },
  };

  const roleMap = await loadAcceptedProjectRoleMap(['project-1'], ApplicationModel);
  assert.equal(receivedFilter.status, 'ACCEPTED');
  assert.deepEqual(receivedFilter.project.$in, ['project-1']);
  assert.equal(
    attachAppliedProjectRoles('project-1', [{ _id: 'user-1' }], roleMap)[0].role,
    'QA Engineer'
  );
});
