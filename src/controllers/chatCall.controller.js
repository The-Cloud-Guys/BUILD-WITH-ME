const CallSession = require('../models/callSession.model');
const { ChatRoom } = require('../models/chat.model');
const { sendCallPush } = require('../services/pushNotification.service');

const isParticipant = (room, userId) =>
  room.participants.some((id) => id.toString() === userId.toString());

const emit = (req, roomId, event, payload) => {
  const sockets = req.app.get('socketManager');
  if (sockets) sockets.io.to(`room:${roomId}`).emit(event, payload);
};

const serialize = (call) => ({
  _id: call._id,
  roomId: call.room?._id || call.room,
  caller: call.caller,
  recipients: call.recipients,
  recipientResponses: call.recipientResponses,
  callType: call.callType,
  status: call.status,
  answeredBy: call.answeredBy,
  answeredAt: call.answeredAt,
  endedAt: call.endedAt,
  expiresAt: call.expiresAt,
  createdAt: call.createdAt,
});

const createCall = async (req, res) => {
  try {
    const { roomId } = req.params;
    const callType = req.body.callType || req.body.type;
    if (!['audio', 'video'].includes(callType)) {
      return res.status(400).json({ message: 'callType must be audio or video' });
    }
    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!isParticipant(room, req.user._id)) {
      return res.status(403).json({ message: 'Not a member of this room' });
    }
    const now = new Date();
    await CallSession.updateMany(
      { room: roomId, status: 'ringing', expiresAt: { $lte: now } },
      { $set: { status: 'missed', endedAt: now } }
    );
    if (await CallSession.exists({
      room: roomId,
      $or: [
        { status: 'ringing', expiresAt: { $gt: now } },
        { status: 'accepted' },
      ],
    })) {
      return res.status(409).json({ message: 'A call is already active in this room' });
    }
    const recipients = room.participants.filter((id) => id.toString() !== req.user._id.toString());
    if (!recipients.length) return res.status(400).json({ message: 'No call recipients available' });
    const call = await CallSession.create({
      room: roomId,
      caller: req.user._id,
      recipients,
      recipientResponses: recipients.map((user) => ({ user, status: 'pending' })),
      callType,
      expiresAt: new Date(Date.now() + 60 * 1000),
    });
    const populated = await CallSession.findById(call._id)
      .populate('caller', 'firstName lastName profilePhoto role')
      .lean();
    const payload = serialize(populated);
    emit(req, roomId, 'call-incoming', payload);
    await sendCallPush({ recipientIds: recipients, call: populated, caller: populated.caller });
    return res.status(201).json({ success: true, call: payload });
  } catch (error) {
    console.error('Create call failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

const getCall = async (req, res) => {
  try {
    const call = await CallSession.findById(req.params.callId)
      .populate('caller', 'firstName lastName profilePhoto role')
      .lean();
    if (!call) return res.status(404).json({ message: 'Call not found' });
    const allowed = [call.caller._id || call.caller, ...call.recipients]
      .some((id) => id.toString() === req.user._id.toString());
    if (!allowed) return res.status(403).json({ message: 'Not a participant in this call' });
    if (call.status === 'ringing' && call.expiresAt <= new Date()) {
      const endedAt = new Date();
      await CallSession.updateOne({ _id: call._id, status: 'ringing' }, { $set: { status: 'missed', endedAt } });
      call.status = 'missed';
      call.endedAt = endedAt;
    }
    return res.json({ call: serialize(call) });
  } catch (error) {
    console.error('Get call failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

const acceptCall = async (req, res) => {
  try {
    const now = new Date();
    const call = await CallSession.findOneAndUpdate(
      { _id: req.params.callId, recipients: req.user._id, status: 'ringing', expiresAt: { $gt: now } },
      { $set: {
        status: 'accepted', answeredBy: req.user._id, answeredAt: now,
        'recipientResponses.$[recipient].status': 'accepted',
        'recipientResponses.$[recipient].respondedAt': now,
      } },
      { new: true, arrayFilters: [{ 'recipient.user': req.user._id }] }
    ).populate('caller', 'firstName lastName profilePhoto role');
    if (!call) return res.status(409).json({ message: 'Call is unavailable, expired, or already answered' });
    const payload = serialize(call);
    emit(req, call.room, 'call-accepted', payload);
    await sendCallPush({ recipientIds: [call.caller._id || call.caller], call, caller: req.user, eventType: 'call_accepted' });
    return res.json({ success: true, call: payload });
  } catch (error) {
    console.error('Accept call failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

const declineCall = async (req, res) => {
  try {
    const now = new Date();
    const call = await CallSession.findOneAndUpdate(
      {
        _id: req.params.callId,
        recipients: req.user._id,
        status: 'ringing',
        recipientResponses: { $elemMatch: { user: req.user._id, status: 'pending' } },
      },
      { $set: {
        'recipientResponses.$[recipient].status': 'declined',
        'recipientResponses.$[recipient].respondedAt': now,
      } },
      { new: true, arrayFilters: [{ 'recipient.user': req.user._id }] }
    ).populate('caller', 'firstName lastName profilePhoto role');
    if (!call) return res.status(409).json({ message: 'Call is unavailable or already answered' });
    if (!call.recipientResponses.some((item) => item.status === 'pending')) {
      call.status = 'declined';
      call.endedAt = now;
      await call.save();
    }
    const payload = serialize(call);
    emit(req, call.room, 'call-declined', { ...payload, declinedBy: req.user._id });
    await sendCallPush({ recipientIds: [call.caller._id || call.caller], call, caller: req.user, eventType: 'call_declined' });
    return res.json({ success: true, call: payload });
  } catch (error) {
    console.error('Decline call failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

const finishCall = (status) => async (req, res) => {
  try {
    const call = await CallSession.findById(req.params.callId)
      .populate('caller', 'firstName lastName profilePhoto role');
    if (!call) return res.status(404).json({ message: 'Call not found' });
    const userId = req.user._id.toString();
    const callerId = (call.caller._id || call.caller).toString();
    const isRecipient = call.recipients.some((id) => id.toString() === userId);
    if ((status === 'cancelled' && callerId !== userId) || (status === 'ended' && callerId !== userId && !isRecipient)) {
      return res.status(403).json({ message: 'Not authorized to update this call' });
    }
    const allowed = status === 'cancelled' ? ['ringing'] : ['accepted'];
    if (!allowed.includes(call.status)) {
      return res.status(409).json({ message: `Call cannot be marked ${status} from its current state` });
    }
    call.status = status;
    call.endedAt = new Date();
    await call.save();
    const payload = serialize(call);
    emit(req, call.room, `call-${status}`, payload);
    const recipients = [callerId, ...call.recipients.map(String)].filter((id) => id !== userId);
    await sendCallPush({ recipientIds: recipients, call, caller: req.user, eventType: `call_${status}` });
    return res.json({ success: true, call: payload });
  } catch (error) {
    console.error('Call update failed:', error.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  acceptCall,
  cancelCall: finishCall('cancelled'),
  createCall,
  declineCall,
  endCall: finishCall('ended'),
  getCall,
};
