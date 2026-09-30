const CallSession = require('../models/callSession.model');
const { getIceServers } = require('../services/iceServer.service');

const getCallIceServers = async (req, res) => {
  try {
    const call = await CallSession.findById(req.params.callId).lean();
    if (!call) return res.status(404).json({ message: 'Call not found' });

    const userId = req.user._id.toString();
    const callerId = call.caller.toString();
    const answeredById = call.answeredBy?.toString();
    const isRingingRecipient = call.status === 'ringing' && call.recipients.some(
      (recipientId) => recipientId.toString() === userId
    );
    const isAuthorized = callerId === userId || answeredById === userId || isRingingRecipient;
    if (!isAuthorized) return res.status(403).json({ message: 'Not a participant in this call' });

    if (call.status === 'ringing' && call.expiresAt <= new Date()) {
      await CallSession.updateOne(
        { _id: call._id, status: 'ringing' },
        { $set: { status: 'missed', endedAt: new Date() } }
      );
      return res.status(410).json({ message: 'Call has expired' });
    }
    if (!['ringing', 'accepted'].includes(call.status)) {
      return res.status(409).json({ message: 'ICE credentials are unavailable for this call state' });
    }

    const credentials = await getIceServers({ callId: call._id, userId });
    return res.json({
      callId: call._id,
      iceServers: credentials.iceServers,
      expiresAt: credentials.expiresAt,
      ttl: credentials.ttl,
    });
  } catch (error) {
    console.error('Get ICE servers failed:', error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Server error',
    });
  }
};

module.exports = { getCallIceServers };
