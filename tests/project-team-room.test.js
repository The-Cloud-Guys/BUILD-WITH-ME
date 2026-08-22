const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTeamRoomName,
  createProjectTeamRoomSynchronizer,
} = require('../src/services/projectTeamRoom.service');

test('team room name is deterministic', () => {
  assert.equal(buildTeamRoomName({ title: 'Compiler Club' }), 'Compiler Club Team');
});

test('team room synchronization is private, owner-administered, and role-aware', async () => {
  const session = { id: 'session' };
  const project = {
    _id: { toString: () => 'project-1' },
    title: 'Compiler Club',
    owner: { toString: () => 'owner-1' },
    teamMembers: [
      { toString: () => 'member-1' },
      { toString: () => 'member-1' },
    ],
  };

  let updateCall;
  const ChatRoomModel = {
    findOneAndUpdate: async (...args) => {
      updateCall = args;
      return { _id: 'room-1' };
    },
  };
  const ApplicationModel = {
    find: () => ({
      select: () => ({
        session: async (receivedSession) => {
          assert.equal(receivedSession, session);
          return [
            {
              applicant: { toString: () => 'member-1' },
              role: 'Backend Developer',
            },
          ];
        },
      }),
    }),
  };

  const sync = createProjectTeamRoomSynchronizer({
    ChatRoomModel,
    ApplicationModel,
  });
  await sync(project, session);

  const [filter, update, options] = updateCall;
  assert.deepEqual(filter, { projectId: project._id, type: 'team_room' });
  assert.equal(update.$set.name, 'Compiler Club Team');
  assert.equal(update.$set.isPrivate, true);
  assert.deepEqual(update.$set.admins, [project.owner]);
  assert.equal(update.$set.participants.length, 2);
  assert.equal(update.$set.participantRoles.get('owner-1'), 'Owner');
  assert.equal(
    update.$set.participantRoles.get('member-1'),
    'Backend Developer'
  );
  assert.equal(options.session, session);
  assert.equal(options.upsert, true);
});
