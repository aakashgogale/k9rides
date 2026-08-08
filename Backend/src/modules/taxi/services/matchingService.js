import { ApiError } from '../../../utils/ApiError.js';
import { normalizePoint } from '../../../utils/geo.js';
import { DISPATCH_TOP_DRIVERS } from '../constants/index.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { getDriverIdsBlockedByUpcomingScheduledRides } from './rideService.js';

const EARTH_RADIUS_METERS = 6371000;

const normalizeVehicleKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeVehicleKeys = (vehicles = []) => {
  const keys = vehicles.flatMap((vehicle) => [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
    String(vehicle?.icon_types || '').replace(/\s+/g, '_'),
  ]);

  return [...new Set(keys.map(normalizeVehicleKey).filter(Boolean))];
};

const normalizeVehicleTypeIds = (vehicleTypeIds = [], vehicleTypeId = null) => {
  const values = Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds];

  if (vehicleTypeId) {
    values.push(vehicleTypeId);
  }

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

export const buildDriverMatchFilters = ({ zoneId, vehicleTypeId, vehicleTypeIds, vehicleTypeKeys, transportType }) => {
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const normalizedVehicleTypeKeys = Array.isArray(vehicleTypeKeys)
    ? [...new Set(vehicleTypeKeys.map(normalizeVehicleKey).filter(Boolean))]
    : [];
  const vehicleTypeClauses = [
    ...(normalizedVehicleTypeIds.length ? [{ vehicleTypeId: { $in: normalizedVehicleTypeIds } }] : []),
    ...(normalizedVehicleTypeKeys.length
      ? [
          { vehicleType: { $in: normalizedVehicleTypeKeys } },
          { vehicleIconType: { $in: normalizedVehicleTypeKeys } },
        ]
      : []),
  ];
  const vehicleTypeFilter =
    vehicleTypeClauses.length > 1
      ? { $or: vehicleTypeClauses }
      : vehicleTypeClauses[0] || {};

  let transportFilter = {};
  if (transportType) {
    if (transportType === 'taxi') {
      transportFilter = { registerFor: { $in: ['taxi', 'both', 'all'] } };
    } else if (transportType === 'delivery') {
      transportFilter = { registerFor: { $in: ['delivery', 'both', 'all'] } };
    } else if (transportType === 'intercity' || transportType === 'outstation') {
      transportFilter = {
        $or: [
          { registerFor: { $in: ['intercity', 'outstation', 'all'] } },
          {
            registerFor: { $in: ['taxi', 'both', 'all'] },
            serviceCategories: { $in: ['outstation', 'Outstation', 'intercity', 'Intercity'] }
          }
        ]
      };
    } else if (transportType === 'pooling') {
      transportFilter = { registerFor: { $in: ['taxi', 'both', 'pooling', 'all'] } };
    } else {
      transportFilter = { registerFor: { $in: [transportType, 'both', 'all'] } };
    }
  }

  const baseFilters = {
    isOnline: true,
    'wallet.isBlocked': { $ne: true },
    ...(zoneId ? { zoneId } : {}),
  };

  if (transportType === 'pooling') {
    baseFilters.isPoolEnabled = true;
    baseFilters.$or = [
      { isOnRide: false },
      { isOnRide: true, activePoolGroupId: { $ne: null } },
    ];
  } else {
    baseFilters.isOnRide = false;
  }

  const andClauses = [];

  if (Object.keys(vehicleTypeFilter).length > 0) {
    andClauses.push(vehicleTypeFilter);
  }
  
  if (Object.keys(transportFilter).length > 0) {
    andClauses.push(transportFilter);
  }

  if (andClauses.length > 1) {
    return { ...baseFilters, $and: andClauses };
  } else if (andClauses.length === 1) {
    return { ...baseFilters, ...andClauses[0] };
  }

  return baseFilters;
};

export const findZoneByPickup = async (pickupCoords) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');

  // Zones are authoritative for dispatch, so every pickup must belong to one polygon.
  return Zone.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: {
          type: 'Point',
          coordinates,
        },
      },
    },
  });
};

const toLocalMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;
  const originLatRadians = (originLat * Math.PI) / 180;
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(originLatRadians);

  return {
    x: (targetLng - originLng) * metersPerDegreeLng,
    y: (targetLat - originLat) * metersPerDegreeLat,
  };
};

const getDistanceToSegmentMeters = (origin, segmentStart, segmentEnd) => {
  const start = toLocalMeters(origin, segmentStart);
  const end = toLocalMeters(origin, segmentEnd);
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = (segmentX * segmentX) + (segmentY * segmentY);

  if (segmentLengthSquared <= 0) {
    return Math.hypot(start.x, start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, -((start.x * segmentX) + (start.y * segmentY)) / segmentLengthSquared),
  );
  const closestX = start.x + (projection * segmentX);
  const closestY = start.y + (projection * segmentY);

  return Math.hypot(closestX, closestY);
};

const getZoneBoundaryCapMeters = (zone, pickupCoords) => {
  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];

  if (ring.length < 3) {
    return null;
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const segmentStart = normalizePoint(ring[index], `zone.geometry.coordinates[0][${index}]`);
    const segmentEnd = normalizePoint(ring[index + 1], `zone.geometry.coordinates[0][${index + 1}]`);
    const distanceMeters = getDistanceToSegmentMeters(pickupCoords, segmentStart, segmentEnd);

    if (Number.isFinite(distanceMeters) && distanceMeters < shortestDistance) {
      shortestDistance = distanceMeters;
    }
  }

  return Number.isFinite(shortestDistance) ? Math.max(0, Math.round(shortestDistance)) : null;
};

const getDistanceBetweenMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;

  const dLat = ((targetLat - originLat) * Math.PI) / 180;
  const dLng = ((targetLng - originLng) * Math.PI) / 180;
  const lat1 = (originLat * Math.PI) / 180;
  const lat2 = (targetLat * Math.PI) / 180;

  const a =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));

  return Math.round(2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const buildGeoNearFilter = (field, coordinates, maxDistance) => ({
  [field]: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
      $maxDistance: maxDistance,
    },
  },
});

const getDispatchAnchorCoordinates = (driver = {}) => {
  const routeCoordinates = Array.isArray(driver?.routeBooking?.anchorLocation?.coordinates)
    ? driver.routeBooking.anchorLocation.coordinates
    : [];

  if (driver?.routeBooking?.enabled && routeCoordinates.length === 2) {
    return routeCoordinates;
  }

  return Array.isArray(driver?.location?.coordinates) ? driver.location.coordinates : [];
};

const sortDriversByDispatchAnchorDistance = (drivers = [], pickupCoords) =>
  [...drivers]
    .map((driver) => {
      const anchorCoordinates = getDispatchAnchorCoordinates(driver);
      return {
        driver,
        distanceMeters:
          anchorCoordinates.length === 2
            ? getDistanceBetweenMeters(pickupCoords, anchorCoordinates)
            : Number.POSITIVE_INFINITY,
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .map(({ driver }) => driver);

const findDriversForZone = async ({
  zoneId,
  coordinates,
  effectiveMaxDistance,
  limit,
  normalizedVehicleTypeIds,
  vehicleTypeKeys,
  transportType,
}) => {
  const commonFilters = buildDriverMatchFilters({
    zoneId,
    vehicleTypeIds: normalizedVehicleTypeIds,
    vehicleTypeKeys,
    transportType,
  });
  const selectedFields =
    'name phone socketId vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel rating location zoneId isOnline isOnRide routeBooking isPoolEnabled activePoolGroupId poolOccupiedSeats maxPoolSeats activePoolRideCount';

  const [liveLocationDrivers, routeBookingDrivers] = await Promise.all([
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': { $ne: true },
      ...buildGeoNearFilter('location', coordinates, effectiveMaxDistance),
    })
      .limit(limit)
      .select(selectedFields),
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': true,
      'routeBooking.anchorLocation': { $ne: null },
      'routeBooking.anchorLocation.coordinates.1': { $exists: true },
      ...buildGeoNearFilter('routeBooking.anchorLocation', coordinates, effectiveMaxDistance),
    })
      .limit(limit)
      .select(selectedFields),
  ]);

  return sortDriversByDispatchAnchorDistance(
    [...liveLocationDrivers, ...routeBookingDrivers].filter(
      (driver, index, items) => items.findIndex((item) => String(item._id) === String(driver._id)) === index,
    ),
    coordinates,
  ).slice(0, limit);
};

export const matchDrivers = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const {
    maxDistance = 3000,
    limit = DISPATCH_TOP_DRIVERS,
    vehicleTypeId,
    vehicleTypeIds,
    transportType,
  } = options;
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const allowedVehicles = normalizedVehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: normalizedVehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const vehicleTypeKeys = normalizeVehicleKeys(allowedVehicles);

  const zone = await findZoneByPickup(coordinates);
  const zoneBoundaryCapMeters = zone ? getZoneBoundaryCapMeters(zone, coordinates) : null;
  const effectiveMaxDistance = Math.max(1, Math.round(maxDistance));

  let drivers = await findDriversForZone({
    zoneId: zone?._id || null,
    coordinates,
    effectiveMaxDistance:
      zoneBoundaryCapMeters && zoneBoundaryCapMeters < effectiveMaxDistance
        ? zoneBoundaryCapMeters
        : effectiveMaxDistance,
    limit,
    normalizedVehicleTypeIds,
    vehicleTypeKeys,
    transportType,
  });

  const requestedSeats = Number(options.seats || 1);
  const filterPoolingEligible = (driver) => {
    if (transportType === 'pooling') {
      if (driver.isPoolEnabled === false) {
        return false;
      }
      if (driver.isOnRide) {
        const occupied = Number(driver.poolOccupiedSeats || 0);
        const maxSeats = Number(driver.maxPoolSeats || 4);
        if (occupied + requestedSeats > maxSeats) {
          return false;
        }
      }
    }
    return true;
  };

  drivers = drivers.filter(filterPoolingEligible);

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
    drivers.map((driver) => String(driver?._id || '')),
  );
  drivers = drivers.filter((driver) => !blockedDriverIds.has(String(driver?._id || '')));

  if (drivers.length === 0 && zone?._id) {
    drivers = await findDriversForZone({
      zoneId: null,
      coordinates,
      effectiveMaxDistance,
      limit,
      normalizedVehicleTypeIds,
      vehicleTypeKeys,
      transportType,
    });

    drivers = drivers.filter(filterPoolingEligible);

    const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
      drivers.map((driver) => String(driver?._id || '')),
    );
    drivers = drivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
  }

  // Development Fallback: If still no matching drivers are found, make a dummy/existing driver online
  // and place them at the pickup location with matching vehicle configuration.
  // ponytail: guarded off in production so a real driver is never hijacked/teleported.
  // Opt in for local/dev by setting ENABLE_DEV_DRIVER_FALLBACK=true.
  const devFallbackEnabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.ENABLE_DEV_DRIVER_FALLBACK === 'true';
  if (drivers.length === 0 && devFallbackEnabled) {
    console.log('[matchDrivers] No matching drivers found. Triggering development fallback...');
    const fallbackDriver = await Driver.findOne({});
    if (fallbackDriver) {
      fallbackDriver.isOnline = true;
      fallbackDriver.isOnRide = false;
      fallbackDriver.approve = true;
      fallbackDriver.status = 'approved';
      fallbackDriver.active = true;
      fallbackDriver.location = {
        type: 'Point',
        coordinates,
      };
      
      const targetVehicleTypeId = vehicleTypeId || (vehicleTypeIds && vehicleTypeIds[0]) || null;
      if (targetVehicleTypeId) {
        fallbackDriver.vehicleTypeId = targetVehicleTypeId;
        const vehicle = await Vehicle.findById(targetVehicleTypeId).lean();
        if (vehicle) {
          const allowedVehicleTypes = ['bike', 'auto', 'car'];
          let mappedVehicleType = 'car';
          const rawType = (vehicle.icon_types || vehicle.icon || '').toLowerCase();
          if (allowedVehicleTypes.includes(rawType)) {
            mappedVehicleType = rawType;
          } else {
            const nameLower = (vehicle.name || '').toLowerCase();
            if (nameLower.includes('bike') || nameLower.includes('motorcycle')) {
              mappedVehicleType = 'bike';
            } else if (nameLower.includes('auto') || nameLower.includes('rickshaw')) {
              mappedVehicleType = 'auto';
            }
          }
          fallbackDriver.vehicleType = mappedVehicleType;
          fallbackDriver.vehicleIconType = vehicle.icon_types || vehicle.icon || 'car';
        }
      }
      
      fallbackDriver.zoneId = zone?._id || null;
      if (fallbackDriver.wallet) {
        fallbackDriver.wallet.isBlocked = false;
        fallbackDriver.wallet.amount = Math.max(fallbackDriver.wallet.amount || 0, 1000);
      }
      await fallbackDriver.save();
      console.log(`[matchDrivers Fallback] Made driver ${fallbackDriver.name} online at coordinates ${coordinates}`);

      // Query again to get this driver
      drivers = await findDriversForZone({
        zoneId: null,
        coordinates,
        effectiveMaxDistance,
        limit,
        normalizedVehicleTypeIds,
        vehicleTypeKeys,
        transportType,
      });

      const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
        drivers.map((driver) => String(driver?._id || '')),
      );
      drivers = drivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
    }
  }

  return {
    zone,
    drivers,
    searchRadiusMeters: effectiveMaxDistance,
    zoneBoundaryCapMeters,
  };
};
