import { Server } from 'socket.io';
import { env } from '../../../config/env.js';
import { normalizePoint, toPoint } from '../../../utils/geo.js';
import { Driver } from '../driver/models/Driver.js';
import {
  broadcastSupportMessage,
  createSupportMessage,
  getSupportParticipantRoom,
  getSupportRoom,
  getSupportRoleRoom,
  markSupportMessagesAsRead,
  parseSupportConversationKey,
  setSupportChatServer,
} from '../chat/services/supportChatService.js';
import {
  addSocketSubscriptions,
  getDispatchState,
  joinRideRoom,
  markDriverRejectedFromDispatch,
  notifyLateAvailableDriver,
  notifyRideAccepted,
  notifyRideBidUpdated,
  setSocketServer,
  startDispatchFlow,
} from '../services/dispatchService.js';
import { findZoneByPickup } from '../services/matchingService.js';
import { acceptRideAssignment, createRideRecord, getRideRoom, submitRideBid } from '../services/rideService.js';
import { SOCKET_EVENTS } from './events.js';
import { registerRideSocketHandlers } from './handlers/rideSocketHandler.js';
import { authorizeRideRoomAccess } from './middleware/rideRoomAuth.js';
import { attachSocketAuth } from './middleware/socketAuth.js';
import { clearDriverRoute } from './services/driverRouteService.js';

const onAsync = (socket, handler) => async (payload = {}) => {
  try {
    await handler(payload);
  } catch (error) {
    socket.emit('errorMessage', {
      message: error.message || 'Socket operation failed',
    });
  }
};

export const configureTaxiSocketServer = (io) => {

  attachSocketAuth(io);
  setSocketServer(io);
  setSupportChatServer(io);

  io.on('connection', async (socket) => {
    const identity = socket.auth;

    addSocketSubscriptions(socket, { role: identity.role, entityId: identity.sub });

    socket.join(getSupportParticipantRoom(identity.role, identity.sub));
    socket.join(getSupportRoleRoom(identity.role));

    if (identity.role === 'driver') {
      await Driver.findByIdAndUpdate(identity.sub, { socketId: socket.id });
      notifyLateAvailableDriver(identity.sub).catch((error) => {
        console.error('Failed to notify late-available driver on socket connect', error);
      });
    }

    socket.on('chat:join', ({ conversationKey }) => {
      if (conversationKey) {
        const parsed = parseSupportConversationKey(conversationKey);

        if (parsed) {
          for (const key of parsed.keys) {
            socket.join(getSupportRoom(key));
          }
          return;
        }

        socket.join(getSupportRoom(conversationKey));
      }
    });

    socket.on(
      'chat:send',
      onAsync(socket, async ({ message, receiverRole, receiverId, conversationKey }) => {
        let nextReceiverRole = receiverRole;
        let nextReceiverId = receiverId;

        if (identity.role === 'admin' && (!nextReceiverRole || !nextReceiverId) && conversationKey) {
          const parsed = parseSupportConversationKey(conversationKey);
          nextReceiverRole = parsed?.peerRole;
          nextReceiverId = parsed?.peerId;
        }

        const savedMessage = await createSupportMessage({
          senderRole: identity.role,
          senderId: identity.sub,
          receiverRole: nextReceiverRole,
          receiverId: nextReceiverId,
          conversationKey,
          message,
        });

        broadcastSupportMessage(savedMessage);
      }),
    );

    socket.on(
      'chat:read',
      onAsync(socket, async ({ conversationKey }) => {
        if (!conversationKey) {
          return;
        }

        await markSupportMessagesAsRead({
          role: identity.role,
          id: identity.sub,
          conversationKey,
        });
      }),
    );

    socket.on(
      'joinRide',
      onAsync(socket, async ({ rideId }) => {
        if (!rideId) {
          return;
        }

        await authorizeRideRoomAccess({ socket, rideId });
        joinRideRoom(socket, rideId);
      }),
    );

    registerRideSocketHandlers({ io, socket, onAsync });

    socket.on(
      'locationUpdate',
      onAsync(socket, async ({ coordinates }) => {
        if (identity.role !== 'driver') {
          return;
        }

        // Drivers push fresh GPS coordinates every few seconds so matching stays accurate.
        const normalizedCoords = normalizePoint(coordinates, 'coordinates');
        const zone = await findZoneByPickup(normalizedCoords);

        await Driver.findByIdAndUpdate(identity.sub, {
          socketId: socket.id,
          location: toPoint(normalizedCoords, 'coordinates'),
          zoneId: zone?._id || null,
        });
        notifyLateAvailableDriver(identity.sub).catch((error) => {
          console.error('Failed to notify late-available driver on location update', error);
        });
      }),
    );

    socket.on(
      'requestRide',
      onAsync(socket, async ({ pickup, drop, fare, estimatedDistanceMeters, estimatedDurationMinutes, vehicleTypeId, vehicleIconType, paymentMethod, serviceType, intercity }) => {
        if (identity.role !== 'user') {
          return;
        }

        // Ride creation and dispatch share the same service path as the REST controller.
        const ride = await createRideRecord({
          userId: identity.sub,
          pickupCoords: normalizePoint(pickup, 'pickup'),
          dropCoords: normalizePoint(drop, 'drop'),
          fare: Number(fare || 0),
          estimatedDistanceMeters: Number(estimatedDistanceMeters || 0),
          estimatedDurationMinutes: Number(estimatedDurationMinutes || 0),
          vehicleTypeId,
          vehicleIconType,
          paymentMethod,
          serviceType,
          intercity,
        });

        joinRideRoom(socket, ride._id);
        await startDispatchFlow(ride);

        socket.emit('rideCreated', {
          rideId: String(ride._id),
          room: getRideRoom(ride._id),
          status: ride.status,
        });

        socket.emit(SOCKET_EVENTS.RIDE_JOINED, {
          rideId: String(ride._id),
          room: getRideRoom(ride._id),
        });
      }),
    );

    socket.on(
      'acceptRide',
      onAsync(socket, async ({ rideId }) => {
        if (identity.role !== 'driver' || !rideId) {
          return;
        }

        // First successful transaction wins; later accepts are rejected by the service layer.
        const ride = await acceptRideAssignment({ rideId, driverId: identity.sub });
        joinRideRoom(socket, ride._id);
        await notifyRideAccepted(ride);

        const acceptedPayload = {
          rideId: String(ride._id),
          room: getRideRoom(ride._id),
          status: ride.status,
          liveStatus: ride.liveStatus,
          acceptedAt: ride.acceptedAt,
        };

        socket.emit('rideAccepted', acceptedPayload);
        socket.emit(SOCKET_EVENTS.RIDE_STATE, acceptedPayload);
        socket.emit(SOCKET_EVENTS.RIDE_JOINED, {
          rideId: String(ride._id),
          room: getRideRoom(ride._id),
        });
      }),
    );

    socket.on(
      'submitRideBid',
      onAsync(socket, async ({ rideId, bidFare }) => {
        if (identity.role !== 'driver' || !rideId) {
          return;
        }

        const result = await submitRideBid({
          rideId,
          driverId: identity.sub,
          bidFare,
        });

        socket.emit('rideBidSubmitted', {
          rideId: String(rideId),
          bid: result.bid,
        });

        await notifyRideBidUpdated(result);
      }),
    );

    socket.on('rejectRide', ({ rideId }) => {
      if (identity.role !== 'driver' || !rideId) {
        return;
      }

      // ponytail: only a driver who was actually offered this ride may reject it — otherwise any
      // driver could poke any rideId. And never broadcast the driverId into the rider's room.
      const state = getDispatchState(rideId);
      const wasOffered = Array.isArray(state?.notifiedDriverIds)
        && state.notifiedDriverIds.map(String).includes(String(identity.sub));
      if (!wasOffered) {
        return;
      }

      markDriverRejectedFromDispatch(rideId, identity.sub);
      socket.to(getRideRoom(rideId)).emit('driverRejectedRide', { rideId });
    });

    socket.on('disconnect', async () => {
      if (identity.role === 'driver') {
        clearDriverRoute(identity.sub);
        await Driver.findByIdAndUpdate(identity.sub, { socketId: null });
      }
    });
  });

  return io;
};
