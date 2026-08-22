const { ChatRoom } = require('../models/chat.model');
const Application = require('../models/application.model');

const buildTeamRoomName = (project) => `${project.title} Team`;

const createProjectTeamRoomSynchronizer = ({ ChatRoomModel, ApplicationModel }) => async (
  project,
  session
) => {
  const participantIds = [project.owner, ...project.teamMembers];
  const uniqueParticipantIds = [
    ...new Map(
      participantIds.map((participant) => [participant.toString(), participant])
    ).values(),
  ];

  const acceptedApplications = await ApplicationModel.find({
    project: project._id,
    status: 'ACCEPTED',
    applicant: { $in: project.teamMembers },
  })
    .select('applicant role')
    .session(session);

  const participantRoles = new Map([[project.owner.toString(), 'Owner']]);
  for (const application of acceptedApplications) {
    participantRoles.set(application.applicant.toString(), application.role);
  }

  return ChatRoomModel.findOneAndUpdate(
    { projectId: project._id, type: 'team_room' },
    {
      $set: {
        name: buildTeamRoomName(project),
        participants: uniqueParticipantIds,
        admins: [project.owner],
        participantRoles,
        isPrivate: true,
      },
      $setOnInsert: {
        projectId: project._id,
        type: 'team_room',
        lastMessageAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      session,
      setDefaultsOnInsert: true,
    }
  );
};

const syncProjectTeamRoom = createProjectTeamRoomSynchronizer({
  ChatRoomModel: ChatRoom,
  ApplicationModel: Application,
});

module.exports = {
  buildTeamRoomName,
  createProjectTeamRoomSynchronizer,
  syncProjectTeamRoom,
};
