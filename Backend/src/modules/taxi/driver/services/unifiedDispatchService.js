import { Driver } from '../models/Driver.js';
import { env } from '../../../../config/env.js';

/**
 * Unified driver candidate selection for dispatch (Phase 3).
 *
 * Returns online, FREE (no activeAssignment), capable drivers near a point whose current work
 * mode accepts the given service. This is the single filter both the taxi and food dispatchers
 * use once UNIFIED_DISPATCH_ENABLED is on — the busy-lock (activeAssignment) is what guarantees
 * a driver on a ride is never offered a delivery and vice-versa.
 *
 * @param {'taxi'|'delivery'} service
 * @param {[number,number]} coordinates  [lng, lat]
 * @param {object} opts { maxDistanceMeters, vehicleTypeIds, limit }
 */
export const findEligibleUnifiedDrivers = async (service, coordinates, opts = {}) => {
  const { maxDistanceMeters = 8000, vehicleTypeIds = null, limit = 20 } = opts;
  // workMode 'all' accepts everything; otherwise it must equal the service.
  const workModes = ['all', service];

  const match = {
    isOnline: true,
    serviceCapabilities: service,        // array-contains match
    workMode: { $in: workModes },
    activeAssignment: null,              // free only — the mutual-exclusion gate
    approve: true,
    deletedAt: null,
  };

  if (service === 'taxi' && Array.isArray(vehicleTypeIds) && vehicleTypeIds.length) {
    match.vehicleTypeId = { $in: vehicleTypeIds };
  }

  return Driver.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates },
        distanceField: 'distanceMeters',
        maxDistance: maxDistanceMeters,
        spherical: true,
        // The Driver schema has TWO 2dsphere indexes (location, routeBooking.anchorLocation),
        // so $geoNear must be told which one to use or Mongo errors out.
        key: 'location',
        query: match,
      },
    },
    { $limit: limit },
  ]);
};

/** Whether the unified dispatch path is active. Both dispatchers check this before switching. */
export const isUnifiedDispatchEnabled = () => Boolean(env.unifiedDispatchEnabled);
