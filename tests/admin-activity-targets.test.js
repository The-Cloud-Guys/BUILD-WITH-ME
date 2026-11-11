const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createActivityUserTargetResolver,
} = require('../src/services/activityTarget.service');

test('activity logs resolve user targets in one batch with name and email', async () => {
  let findCalls = 0;
  const UserModel = {
    find(filter) {
      findCalls += 1;
      assert.deepEqual(filter, {
        _id: { $in: ['user-1', 'user-2'] },
      });
      return {
        select(selection) {
          assert.equal(selection, 'firstName lastName email role profilePhoto');
          return {
            async lean() {
              return [
                {
                  _id: 'user-1',
                  firstName: 'Ada',
                  lastName: 'Lovelace',
                  email: 'ada@example.com',
                  role: 'Developer',
                  profilePhoto: 'users/user-1/profile.jpg',
                },
                {
                  _id: 'user-2',
                  firstName: 'Grace',
                  lastName: 'Hopper',
                  email: 'grace@example.com',
                  role: 'Developer',
                  profilePhoto: null,
                },
              ];
            },
          };
        },
      };
    },
  };
  const resolveTargets = createActivityUserTargetResolver({ UserModel });
  const activities = await resolveTargets([
    { _id: 'activity-1', targetType: 'user', targetId: 'user-1' },
    { _id: 'activity-2', targetType: 'user', targetId: 'user-2' },
    { _id: 'activity-3', targetType: 'user', targetId: 'user-1' },
  ], async (value) => value ? `signed:${value}` : null);

  assert.equal(findCalls, 1);
  assert.equal(activities[0].target.fullName, 'Ada Lovelace');
  assert.equal(activities[0].target.email, 'ada@example.com');
  assert.equal(activities[0].target.profilePhoto, 'signed:users/user-1/profile.jpg');
  assert.equal(activities[1].target.fullName, 'Grace Hopper');
});

test('activity logs retain targetId and return null when a target user is unavailable', async () => {
  const UserModel = {
    find() {
      return {
        select() {
          return { lean: async () => [] };
        },
      };
    },
  };
  const resolveTargets = createActivityUserTargetResolver({ UserModel });
  const [activity] = await resolveTargets([
    { _id: 'activity-1', targetType: 'user', targetId: 'deleted-user' },
  ]);

  assert.equal(activity.targetId, 'deleted-user');
  assert.equal(activity.target, null);
});

test('non-user activity targets do not query the user collection', async () => {
  const UserModel = {
    find() {
      throw new Error('User lookup should not run');
    },
  };
  const resolveTargets = createActivityUserTargetResolver({ UserModel });
  const [activity] = await resolveTargets([
    { _id: 'activity-1', targetType: 'project', targetId: 'project-1' },
  ]);

  assert.equal(activity.target, null);
});
