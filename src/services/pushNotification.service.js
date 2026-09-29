const NotificationDevice = require('../models/notificationDevice.model');
const { getFirebaseMessaging } = require('./firebase.service');

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const stringifyData = (data = {}) => Object.fromEntries(
  Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)])
);

const sendPushToUsers = async ({ userIds, notification, data, android = {}, dataOnly = false }) => {
  const uniqueUserIds = [...new Set(userIds.map(String))];
  if (!uniqueUserIds.length) return { attempted: 0, delivered: 0, failed: 0 };

  let devices = [];
  try {
    devices = await NotificationDevice.find({
      user: { $in: uniqueUserIds },
      isActive: true,
    }).select('_id token').lean();
    if (!devices.length) return { attempted: 0, delivered: 0, failed: 0 };

    const androidConfig = { priority: android.priority || 'high' };
    if (!dataOnly && android.channelId) {
      androidConfig.notification = { channelId: android.channelId, sound: android.sound || 'default' };
    }
    if (android.ttl) androidConfig.ttl = android.ttl;
    const multicast = {
      tokens: devices.map((device) => device.token),
      data: stringifyData(data),
      android: androidConfig,
    };
    if (!dataOnly && notification) multicast.notification = notification;
    const response = await getFirebaseMessaging().sendEachForMulticast(multicast);

    const invalidDeviceIds = [];
    response.responses.forEach((result, index) => {
      if (!result.success && INVALID_TOKEN_CODES.has(result.error?.code)) {
        invalidDeviceIds.push(devices[index]._id);
      }
    });
    if (invalidDeviceIds.length) {
      await NotificationDevice.updateMany(
        { _id: { $in: invalidDeviceIds } },
        { $set: { isActive: false } }
      );
    }

    return {
      attempted: devices.length,
      delivered: response.successCount,
      failed: response.failureCount,
    };
  } catch (error) {
    console.error('Push notification delivery failed:', error.message);
    return { attempted: devices.length, delivered: 0, failed: devices.length };
  }
};

const sendChatMessagePush = ({ recipientIds, message, room }) => {
  const senderName = [message.sender?.firstName, message.sender?.lastName]
    .filter(Boolean)
    .join(' ') || 'Someone';
  const isGroup = room.type !== 'direct';
  return sendPushToUsers({
    userIds: recipientIds,
    notification: {
      title: isGroup ? room.name : senderName,
      body: message.content ? message.content.slice(0, 120) : 'Sent an attachment',
    },
    data: {
      type: 'chat_message',
      roomId: room._id,
      messageId: message._id,
      senderId: message.sender?._id || message.sender,
      route: `/chat/${room._id}`,
    },
    android: { channelId: 'messages' },
  });
};

const sendCallPush = ({ recipientIds, call, caller, eventType = 'incoming_call' }) => {
  const callerName = [caller?.firstName, caller?.lastName].filter(Boolean).join(' ') || 'Someone';
  const incoming = eventType === 'incoming_call';
  return sendPushToUsers({
    userIds: recipientIds,
    notification: incoming
      ? { title: `Incoming ${call.callType} call`, body: callerName }
      : { title: 'Call update', body: eventType.replaceAll('_', ' ') },
    data: {
      type: eventType,
      callId: call._id,
      roomId: call.room?._id || call.room,
      callType: call.callType,
      callerId: call.caller?._id || call.caller,
      callerName,
      status: call.status,
      route: `/calls/${call._id}`,
    },
    android: {
      channelId: incoming ? 'incoming_calls' : 'messages',
      priority: 'high',
      ttl: incoming ? 60 * 1000 : undefined,
    },
    dataOnly: true,
  });
};

module.exports = { sendCallPush, sendChatMessagePush, sendPushToUsers, stringifyData };
