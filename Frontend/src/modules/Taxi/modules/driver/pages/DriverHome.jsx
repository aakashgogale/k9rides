import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell,
    CalendarClock,
    Camera,
    Navigation,
    Wallet,
    Clock,
    Bike,
    Power,
    Target,
    Layers,
    Zap,
    IndianRupee,
    TrendingUp,
    Star,
    ChevronRight,
    MapPin,
    User,
    Shield,
    Mail,
    BarChart2,
    Check,
    X
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GoogleMap, Marker } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import LowBalanceModal from './LowBalanceModal';


import MapGrid from '@/assets/premium_grid_map.png';
import DriverBottomNav from '../../shared/components/DriverBottomNav';
import IncomingRideRequest from './IncomingRideRequest';
import api from '../../../shared/api/axiosInstance';
import WorkModeToggle from '../components/WorkModeToggle';
import { useSettings } from '../../../shared/context/SettingsContext';
import { uploadService } from '../../../shared/services/uploadService';
import { BACKEND_ORIGIN } from '../../../shared/api/runtimeConfig';

// Vehicle Icons for Map
import BikeIcon from '@/assets/icons/bike.png';
import CarIcon from '@/assets/icons/car.png';
import AutoIcon from '@/assets/icons/auto.png';
import TruckIcon from '@/assets/icons/truck.png';
import EhcvIcon from '@/assets/icons/ehcv.png';
import HcvIcon from '@/assets/icons/hcv.png';
import LcvIcon from '@/assets/icons/LCV.png';
import McvIcon from '@/assets/icons/mcv.png';
import LuxuryIcon from '@/assets/icons/Luxury.png';
import PremiumIcon from '@/assets/icons/Premium.png';
import SuvIcon from '@/assets/icons/SUV.png';

import { socketService } from '../../../shared/api/socket';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../admin/utils/googleMaps';
import { cancelDriverScheduledRide, getCurrentDriver, getDriverDocumentTemplates, getDriverNotifications, getDriverScheduledRides, getLocalDriverToken } from '../services/registrationService';
import { addLocalDriverNotification, getUnreadDriverNotificationCount, getVisibleDriverNotifications } from '../utils/notificationState';
import { getScheduledRideCountdown } from '../utils/scheduledRideTime';
import {
    playRideRequestAlertSound,
    stopRideRequestAlertSound,
    unlockRideRequestAlertSound,
} from '../utils/rideRequestAlertSound';

const Motion = motion;

const containerStyle = {
    width: '100%',
    height: '100%'
};

const DEFAULT_MAP_CENTER = {
    lat: 22.7196,
    lng: 75.8577
};

const DEFAULT_MAP_COORDS = [75.8577, 22.7196];

const getGeoLocationErrorMessage = (error, { purpose = 'generic' } = {}) => {
    const code = Number(error?.code);

    if (code === 1) {
        return purpose === 'online'
            ? 'Please allow location permission to go online.'
            : 'Live location updates are paused. Please allow location permission.';
    }

    if (code === 2) {
        return 'Could not detect your current location.';
    }

    if (code === 3) {
        return purpose === 'online'
            ? 'Timed out while fetching your location. Please try again.'
            : 'Live location refresh timed out.';
    }

    return purpose === 'online'
        ? 'Could not fetch your location to go online.'
        : 'Could not update live location.';
};

const getCurrentCoords = ({ purpose = 'generic' } = {}) => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
        reject(new Error('Location is not available on this device.'));
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
        (error) => reject(new Error(getGeoLocationErrorMessage(error, { purpose }))),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 },
    );
});

const toLatLng = (coordinates) => {
    const [lng, lat] = coordinates || [];

    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return DEFAULT_MAP_CENTER;
    }

    return { lat: Number(lat), lng: Number(lng) };
};

const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read selected selfie'));
        reader.readAsDataURL(file);
    });

const loadImageFromDataUrl = (dataUrl) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to process selected selfie'));
        image.src = dataUrl;
    });

const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
};

const compressSelfieForUpload = async (file) => {
    const originalDataUrl = await readFileAsDataUrl(file);

    if (typeof document === 'undefined') {
        return originalDataUrl;
    }

    const image = await loadImageFromDataUrl(originalDataUrl);
    const maxSide = 960;
    const largestSide = Math.max(image.width, image.height, 1);
    const scale = largestSide > maxSide ? maxSide / largestSide : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
        return originalDataUrl;
    }

    context.drawImage(image, 0, 0, width, height);

    let quality = 0.82;
    let compressed = canvas.toDataURL('image/jpeg', quality);

    while (compressed.length > 8_500_000 && quality > 0.45) {
        quality -= 0.1;
        compressed = canvas.toDataURL('image/jpeg', quality);
    }

    return compressed;
};

const compressSelfieDataUrl = async (dataUrl) => {
    const image = await loadImageFromDataUrl(dataUrl);
    const maxSide = 960;
    const largestSide = Math.max(image.width, image.height, 1);
    const scale = largestSide > maxSide ? maxSide / largestSide : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
        return dataUrl;
    }

    context.drawImage(image, 0, 0, width, height);

    let quality = 0.82;
    let compressed = canvas.toDataURL('image/jpeg', quality);

    while (compressed.length > 8_500_000 && quality > 0.45) {
        quality -= 0.1;
        compressed = canvas.toDataURL('image/jpeg', quality);
    }

    return compressed;
};

const getMapIconForVehicle = (iconType = '') => {
    const raw = String(iconType || '').trim();
    if (/^(https?:|data:image\/|blob:)/.test(raw)) {
        return raw;
    }
    if (raw.startsWith('/')) {
        return `${BACKEND_ORIGIN}${raw}`;
    }
    if (/^(uploads\/|images\/)/.test(raw)) {
        return `${BACKEND_ORIGIN}/${raw}`;
    }

    const value = raw.toLowerCase();

    if (value.includes('bike')) return BikeIcon;
    if (value.includes('auto')) return AutoIcon;
    if (value.includes('ehc')) return EhcvIcon;
    if (value.includes('hcv')) return HcvIcon;
    if (value.includes('lcv')) return LcvIcon;
    if (value.includes('mcv')) return McvIcon;
    if (value.includes('truck')) return TruckIcon;
    if (value.includes('lux')) return LuxuryIcon;
    if (value.includes('premium')) return PremiumIcon;
    if (value.includes('suv')) return SuvIcon;

    return CarIcon;
};

const formatPoint = (point, fallback) => {
    const [lng, lat] = point?.coordinates || [];

    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
    }

    return fallback;
};

const formatScheduledDateTime = (value) => {
    if (!value) {
        return 'Schedule time not available';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'Schedule time not available';
    }

    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatDistanceLabel = (meters) => {
    const value = Number(meters || 0);
    if (!Number.isFinite(value) || value <= 0) {
        return 'Nearby';
    }

    if (value < 1000) {
        return `${Math.round(value)} m`;
    }

    return `${(value / 1000).toFixed(1)} km`;
};

const formatFareLabel = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        return 'Rs 0';
    }

    return `Rs ${amount}`;
};

const normalizeTodaySummary = (value = {}) => ({
    dateKey: String(value?.dateKey || ''),
    earnings: Number(value?.earnings || 0),
    distanceMeters: Number(value?.distanceMeters || 0),
    rides: Number(value?.rides || 0),
    activeSeconds: Math.max(0, Math.round(Number(value?.activeSeconds || 0))),
});

const formatSummaryMoney = (value) => `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;

const formatSummaryDistance = (meters) => {
    const value = Number(meters || 0);

    if (!Number.isFinite(value) || value <= 0) {
        return '0 km';
    }

    const km = value / 1000;
    return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
};

const isOwnerManagedDriverProfile = (driver = {}) => {
    const accountType = String(
        driver?.accountType
        || driver?.onboarding?.accountType
        || driver?.onboarding?.role
        || driver?.role
        || '',
    ).toLowerCase();

    return Boolean(
        driver?.owner_id
        || driver?.ownerId
        || driver?.fleet_id
        || driver?.fleetId
        || driver?.owner?._id
        || driver?.onboarding?.owner_id
        || ['fleet_driver', 'fleet_drivers'].includes(accountType),
    );
};

const getWalletAlertState = (wallet = {}, { ignoreRestrictions = false } = {}) => {
    const balance = Number(wallet.balance || 0);
    const cashLimit = Math.max(0, Number(wallet.cashLimit || 0));
    const minimumBalanceForOrders = Number(wallet.minimumBalanceForOrders || 0);
    const cashLimitUsed = Math.max(0, balance < 0 ? Math.abs(balance) : 0);
    const remainingCashLimit = Math.max(0, cashLimit - cashLimitUsed);
    const warningThreshold = cashLimit > 0
        ? Math.min(cashLimit, Math.max(50, cashLimit * 0.15))
        : 0;
    const belowMinimumBalance = balance <= minimumBalanceForOrders;
    const cashLimitExceeded = cashLimit > 0 && remainingCashLimit <= 0;
    const rawBlocked = Boolean(wallet.isBlocked) || belowMinimumBalance || cashLimitExceeded;
    const isBlocked = ignoreRestrictions ? false : rawBlocked;
    const isWarning = ignoreRestrictions ? false : (!isBlocked && cashLimitUsed > 0 && remainingCashLimit <= warningThreshold);

    return {
        balance,
        cashLimit,
        minimumBalanceForOrders,
        cashLimitUsed,
        remainingCashLimit,
        warningThreshold,
        belowMinimumBalance: ignoreRestrictions ? false : belowMinimumBalance,
        cashLimitExceeded: ignoreRestrictions ? false : cashLimitExceeded,
        isBlocked,
        isWarning,
    };
};

const isScheduledRideForFuture = (value) => {
    if (!value) {
        return false;
    }

    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
};

const createScheduledRidePreview = (ride) => ({
    rideId: ride.rideId,
    type: ride.type || ride.serviceType || 'ride',
    fare: formatFareLabel(ride.fare || ride.baseFare),
    distance: formatDistanceLabel(ride.estimatedDistanceMeters),
    payment: ride.paymentMethod || 'cash',
    pickup: ride.pickupAddress || 'Pickup point',
    drop: ride.dropAddress || 'Drop point',
    scheduledAt: ride.scheduledAt || null,
    customer: {
        name: ride.user?.name || 'Customer',
        phone: ride.user?.phone || '',
    },
    driverId: ride.driverId || '',
    isAssignedToCurrentDriver: Boolean(ride.isAssignedToCurrentDriver),
    raw: {
        fare: ride.fare,
        baseFare: ride.baseFare,
        bookingMode: ride.bookingMode || 'normal',
        parcel: ride.parcel || null,
        intercity: ride.intercity || null,
        user: ride.user || null,
        pickupAddress: ride.pickupAddress || '',
        dropAddress: ride.dropAddress || '',
        scheduledAt: ride.scheduledAt || null,
        ride,
    },
});

const normalizeJobType = (job = {}) => {
    const value = String(job.type || job.serviceType || 'ride').toLowerCase();
    if (value === 'parcel') return 'parcel';
    if (value === 'intercity') return 'intercity';
    return 'ride';
};

const getJobTitle = (type) => {
    if (type === 'parcel') return 'Delivery';
    if (type === 'intercity') return 'Intercity Ride';
    return 'Taxi Ride';
};

const formatTripDistance = (job = {}) => {
    const estimatedMeters = Number(job.estimatedDistanceMeters || job.raw?.estimatedDistanceMeters || 0);

    if (Number.isFinite(estimatedMeters) && estimatedMeters > 0) {
        return estimatedMeters < 1000
            ? `${Math.max(50, Math.round(estimatedMeters / 10) * 10)} m`
            : `${(estimatedMeters / 1000).toFixed(estimatedMeters >= 10000 ? 0 : 1)} km`;
    }

    if (job.intercity?.distance) {
        return `${job.intercity.distance} km`;
    }

    if (job.raw?.intercity?.distance) {
        return `${job.raw.intercity.distance} km`;
    }

    if (job.radius) {
        return `within ${(Number(job.radius) / 1000).toFixed(1)} km`;
    }

    if (job.raw?.radius) {
        return `within ${(Number(job.raw.radius) / 1000).toFixed(1)} km`;
    }

    return 'nearby';
};

const unwrapApiPayload = (response) => response?.data?.data || response?.data || response;
const withDriverAuthorization = (token) => (
    token
        ? {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
        : {}
);

const readStoredDriverInfo = () => {
    try {
        return JSON.parse(localStorage.getItem('driverInfo') || '{}');
    } catch {
        return {};
    }
};

const persistStoredDriverInfo = (updates = {}) => {
    const current = readStoredDriverInfo();
    const next = {
        ...current,
        ...updates,
    };
    localStorage.setItem('driverInfo', JSON.stringify(next));
    return next;
};

const readStoredDriverCoords = () => {
    const stored = readStoredDriverInfo();
    const coordinates = stored?.location?.coordinates || stored?.coordinates;

    if (Array.isArray(coordinates) && coordinates.length === 2) {
        const [lng, lat] = coordinates;
        if (Number.isFinite(Number(lng)) && Number.isFinite(Number(lat))) {
            return [Number(lng), Number(lat)];
        }
    }

    return null;
};

const getDocumentExpiryValue = (document = {}) => (
    document?.expiryDate
    || document?.expiry_date
    || document?.expiry
    || document?.expiresAt
    || null
);

const getDocumentReviewStatus = (document = {}) => String(
    document?.status
    || document?.verificationStatus
    || document?.approvalStatus
    || document?.reviewStatus
    || '',
).trim().toLowerCase();

const getDocumentReason = (document = {}) => String(
    document?.comment
    || document?.remarks
    || document?.reason
    || document?.admin_comment
    || document?.rejection_reason
    || '',
).trim();

const isExpiredDateValue = (value) => {
    if (!value) {
        return false;
    }

    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
};

const DRIVER_ROUTE_BOOKING_STORAGE_KEY = 'driver_route_booking_preferences';
const DRIVER_VEHICLE_REAPPROVAL_PENDING_KEY = 'driver_vehicle_reapproval_pending';
const getTodaySelfieKey = () => new Date().toISOString().slice(0, 10);

const readRouteBookingPreferences = () => {
    try {
        const raw = localStorage.getItem(DRIVER_ROUTE_BOOKING_STORAGE_KEY);
        return raw ? JSON.parse(raw) : { enabled: false, coordinates: null, label: '' };
    } catch {
        return { enabled: false, coordinates: null, label: '' };
    }
};

const writeRouteBookingPreferences = (nextValue) => {
    localStorage.setItem(DRIVER_ROUTE_BOOKING_STORAGE_KEY, JSON.stringify(nextValue));
    return nextValue;
};

const normalizeRouteBookingPreferences = (routeBooking = null) => {
    const coordinates = Array.isArray(routeBooking?.coordinates) && routeBooking.coordinates.length === 2
        ? routeBooking.coordinates
        : null;

    return {
        enabled: Boolean(routeBooking?.enabled && coordinates),
        coordinates,
        label: String(routeBooking?.label || '').trim(),
        updatedAt: routeBooking?.updatedAt || null,
    };
};

const isDriverVehicleApprovalPending = (driver = {}) =>
    driver?.approve === false || String(driver?.status || '').toLowerCase() === 'pending';

const hasSelfieForToday = (onlineSelfie = null) =>
    String(onlineSelfie?.forDate || '').trim() === getTodaySelfieKey() &&
    Boolean(String(onlineSelfie?.imageUrl || '').trim());

const mapStyles = [
    { "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] },
    { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
    { "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
    { "elementType": "labels.text.stroke", "stylers": [{ "color": "#f5f5f5" }] },
    { "featureType": "administrative.land_parcel", "elementType": "labels.text.fill", "stylers": [{ "color": "#bdbdbd" }] },
    { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
    { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
    { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
    { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
    { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }] },
    { "featureType": "road.arterial", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
    { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#dadada" }] },
    { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
    { "featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
    { "featureType": "transit.line", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
    { "featureType": "transit.station", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
    { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#c9c9c9" }] },
    { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] }
];

const DriverHome = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [showCompletedTripModal, setShowCompletedTripModal] = useState(false);
    const [completedTripDetails, setCompletedTripDetails] = useState(null);
    const { settings, activeLogo } = useSettings();
    const appName = settings.general?.app_name || 'App';
    const appLogo = activeLogo || settings.general?.logo || settings.customization?.logo;
    const storedDriverInfo = useMemo(() => readStoredDriverInfo(), []);
    const [isOwnerManagedDriver, setIsOwnerManagedDriver] = useState(() => isOwnerManagedDriverProfile(storedDriverInfo));
    const [isOnline, setIsOnline] = useState(false);
    const [workMode, setWorkMode] = useState('all');
    const [serviceCapabilities, setServiceCapabilities] = useState([]);
    const [showRequest, setShowRequest] = useState(false);
    const [showLowBalanceModal, setShowLowBalanceModal] = useState(false);
    const [showCancelledTripModal, setShowCancelledTripModal] = useState(false);
    const [cancelledTripMessage, setCancelledTripMessage] = useState('');

    const [currentRequest, setCurrentRequest] = useState(null);
    const [todaySummary, setTodaySummary] = useState(() => normalizeTodaySummary());
    const [isTodaySummaryExpanded, setIsTodaySummaryExpanded] = useState(true);
    const [map, setMap] = useState(null);
    const [driverCoords, setDriverCoords] = useState(() => readStoredDriverCoords());
    const [statusMessage, setStatusMessage] = useState('');
    const [socketStatus, setSocketStatus] = useState('offline');
    const [notificationCount, setNotificationCount] = useState(0);
    const [scheduledRideCount, setScheduledRideCount] = useState(0);
    const [scheduledRides, setScheduledRides] = useState([]);
    const [isScheduleSheetOpen, setIsScheduleSheetOpen] = useState(false);
    const [isScheduleLoading, setIsScheduleLoading] = useState(false);
    const [selectedScheduledRide, setSelectedScheduledRide] = useState(null);
    const [scheduleNow, setScheduleNow] = useState(() => Date.now());
    const [cancellingScheduledRideId, setCancellingScheduledRideId] = useState('');
    const [acceptingRideId, setAcceptingRideId] = useState('');
    const [isHydratingDriver, setIsHydratingDriver] = useState(true);
    const [isTogglingDuty, setIsTogglingDuty] = useState(false);
    const [showOfflineConfirm, setShowOfflineConfirm] = useState(false);
    const [showOnlineSelfiePrompt, setShowOnlineSelfiePrompt] = useState(false);
    const [showSelfieCameraCapture, setShowSelfieCameraCapture] = useState(false);
    const [selfieUploading, setSelfieUploading] = useState(false);
    const [selfieError, setSelfieError] = useState('');
    const [onlineSelfie, setOnlineSelfie] = useState(null);
    const [routeBookingPreferences, setRouteBookingPreferences] = useState(() => readRouteBookingPreferences());
    const [vehicleReapprovalPending, setVehicleReapprovalPending] = useState(() => localStorage.getItem(DRIVER_VEHICLE_REAPPROVAL_PENDING_KEY) === 'true');
    const [driverDocuments, setDriverDocuments] = useState({});
    const [documentTemplates, setDocumentTemplates] = useState([]);
    const [vehicleIconType, setVehicleIconType] = useState(
        () => storedDriverInfo?.vehicleIconType || storedDriverInfo?.vehicleType || 'car',
    );
    const [vehicleIconUrl, setVehicleIconUrl] = useState(
        () => storedDriverInfo?.vehicleIconUrl || '',
    );
    const [walletSummary, setWalletSummary] = useState({
        balance: 0,
        cashLimit: 500,
        minimumBalanceForOrders: 0,
        availableForOrders: 0,
        isBlocked: false,
    });
    const driverCoordsRef = useRef(readStoredDriverCoords());
    const selfieCameraInputRef = useRef(null);
    const selfieVideoRef = useRef(null);
    const selfieStreamRef = useRef(null);
    const acceptingRideIdRef = useRef('');
    const currentRequestRef = useRef(null);
    const recoveryTimeoutsRef = useRef([]);
    const recoveryInFlightRef = useRef(false);
    const lastDutyToggleAtRef = useRef(0);
    const driverPosition = useMemo(() => toLatLng(driverCoords || DEFAULT_MAP_COORDS), [driverCoords]);
    const mapVehicleIcon = useMemo(
        () => getMapIconForVehicle(vehicleIconUrl || vehicleIconType),
        [vehicleIconType, vehicleIconUrl],
    );

    const walletAlertState = useMemo(
        () => getWalletAlertState(walletSummary, { ignoreRestrictions: isOwnerManagedDriver }),
        [walletSummary, isOwnerManagedDriver],
    );

    const { isLoaded } = useAppGoogleMapsLoader();

    const refreshNotificationCount = useCallback(async () => {
        try {
            const response = await getDriverNotifications();
            const results = response?.data?.results || [];
            const visibleNotifications = getVisibleDriverNotifications(results);
            setNotificationCount(getUnreadDriverNotificationCount(visibleNotifications));
        } catch {
            setNotificationCount(0);
        }
    }, []);

    const loadScheduledRides = useCallback(async () => {
        setIsScheduleLoading(true);

        try {
            const response = await getDriverScheduledRides({ limit: 20 });
            const results = response?.data?.results || [];
            const nextScheduledRides = results
                .filter((ride) => ride?.scheduledAt)
                .sort((firstRide, secondRide) => new Date(firstRide.scheduledAt).getTime() - new Date(secondRide.scheduledAt).getTime());

            setScheduledRides(nextScheduledRides);
            setScheduledRideCount(nextScheduledRides.length);
        } catch {
            setScheduledRides([]);
            setScheduledRideCount(0);
        } finally {
            setIsScheduleLoading(false);
        }
    }, []);

    const handleCancelScheduledRide = useCallback(async (ride) => {
        const rideId = String(ride?.rideId || '');

        if (!rideId || cancellingScheduledRideId) {
            return;
        }

        const confirmed = window.confirm('Cancel this scheduled ride? The user will be notified immediately.');
        if (!confirmed) {
            return;
        }

        setCancellingScheduledRideId(rideId);

        try {
            await cancelDriverScheduledRide(rideId);
            toast.success('Scheduled ride cancelled. User notified.', {
                duration: 3200,
                className: 'font-bold text-[13px] rounded-2xl shadow-xl border border-rose-50 bg-white',
            });
            setSelectedScheduledRide(null);
            await loadScheduledRides();
        } catch (error) {
            toast.error(error?.response?.data?.message || error?.message || 'Failed to cancel scheduled ride');
        } finally {
            setCancellingScheduledRideId('');
        }
    }, [cancellingScheduledRideId, loadScheduledRides]);

    useEffect(() => {
        if (location.state?.showBillModal && location.state?.completedRide) {
            setCompletedTripDetails(location.state.completedRide);
            setShowCompletedTripModal(true);
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    useEffect(() => {
        if (location.state?.cancelled) {
            setCancelledTripMessage(location.state.statusMessage || 'The user has cancelled this ride.');
            setShowCancelledTripModal(true);
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location.state, navigate]);

    useEffect(() => {
        const unlock = () => unlockRideRequestAlertSound();

        window.addEventListener('pointerdown', unlock, { passive: true });
        window.addEventListener('keydown', unlock);

        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, []);

    useEffect(() => {
        refreshNotificationCount();
        loadScheduledRides();

        const handleFocus = () => {
            refreshNotificationCount();
            loadScheduledRides();
        };
        const refreshInterval = window.setInterval(() => {
            refreshNotificationCount();
            loadScheduledRides();
        }, 30000);

        window.addEventListener('focus', handleFocus);

        return () => {
            window.clearInterval(refreshInterval);
            window.removeEventListener('focus', handleFocus);
        };
    }, [loadScheduledRides, refreshNotificationCount]);

    useEffect(() => {
        if (scheduledRides.length === 0) {
            return undefined;
        }

        const interval = window.setInterval(() => {
            setScheduleNow(Date.now());
        }, 1000);

        return () => {
            window.clearInterval(interval);
        };
    }, [scheduledRides.length]);

    useEffect(() => {
        if (isOwnerManagedDriver) {
            setShowLowBalanceModal(false);
        }
    }, [isOwnerManagedDriver]);

    useEffect(() => {
        currentRequestRef.current = currentRequest;
    }, [currentRequest]);

    useEffect(() => {
        const syncLocalDriverPreferences = () => {
            setRouteBookingPreferences(readRouteBookingPreferences());
            setVehicleReapprovalPending(localStorage.getItem(DRIVER_VEHICLE_REAPPROVAL_PENDING_KEY) === 'true');
        };

        window.addEventListener('focus', syncLocalDriverPreferences);
        return () => {
            window.removeEventListener('focus', syncLocalDriverPreferences);
        };
    }, []);

    useEffect(() => {
        if (!isOnline || !showRequest || !currentRequest?.rideId) {
            return undefined;
        }

        playRideRequestAlertSound();

        const replayAlert = () => {
            if (document.visibilityState === 'visible' && currentRequestRef.current?.rideId) {
                playRideRequestAlertSound();
            }
        };

        window.addEventListener('focus', replayAlert);
        window.addEventListener('pageshow', replayAlert);
        document.addEventListener('visibilitychange', replayAlert);

        return () => {
            window.removeEventListener('focus', replayAlert);
            window.removeEventListener('pageshow', replayAlert);
            document.removeEventListener('visibilitychange', replayAlert);
        };
    }, [currentRequest?.rideId, isOnline, showRequest]);

    const clearRecoveryBurst = useCallback(() => {
        recoveryTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
        recoveryTimeoutsRef.current = [];
    }, []);

    useEffect(() => clearRecoveryBurst, [clearRecoveryBurst]);


    const fetchActiveJob = useCallback(async (type = 'ride') => {
        const normalizedType = String(type || 'ride').toLowerCase();
        const endpoint = normalizedType === 'parcel' ? '/deliveries/active/me' : '/rides/active/me';
        const driverToken = getLocalDriverToken();
        const response = await api.get(endpoint, {
            ...withDriverAuthorization(driverToken),
            params: { t: Date.now(), type: normalizedType },
        });
        return unwrapApiPayload(response);
    }, []);

    const openActiveJob = useCallback((job) => {
        if (!job?.rideId) {
            return false;
        }

        const currentType = normalizeJobType(job);

        navigate('/taxi/driver/active-trip', {
            replace: true,
            state: {
                type: currentType,
                rideId: job.rideId,
                otp: job.otp || '',
                request: {
                    type: currentType,
                    title: getJobTitle(currentType),
                    fare: `Rs ${job.fare || 0}`,
                    payment: job.paymentMethod || 'Cash',
                    pickup: job.pickupAddress || formatPoint(job.pickupLocation, 'Pickup Location'),
                    drop: job.dropAddress || formatPoint(job.dropLocation, 'Drop Location'),
                    distance: formatTripDistance(job),
                    requestId: job.rideId,
                    rideId: job.rideId,
                    otp: job.otp || '',
                    raw: job,
                },
                currentDriverCoords: driverCoordsRef.current || job.lastDriverLocation?.coordinates || null,
            },
        });

        return true;
    }, [navigate]);

    const onLoad = useCallback(function callback(map) {
        setMap(map);
    }, []);

    const onUnmount = useCallback(function callback() {
        setMap(null);
    }, []);

    const mapOptions = useMemo(() => ({
        styles: mapStyles,
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false
    }), []);

    const updateDriverLocation = useCallback(async ({ quiet = false } = {}) => {
        try {
            const coordinates = await getCurrentCoords({ purpose: 'online' });
            driverCoordsRef.current = coordinates;
            setDriverCoords(coordinates);
            persistStoredDriverInfo({
                location: {
                    coordinates,
                },
                coordinates,
            });
            map?.panTo(toLatLng(coordinates));
            if (!quiet) {
                setStatusMessage('Current location updated.');
            }
            return coordinates;
        } catch (error) {
            if (!quiet) {
                setStatusMessage(error.message || 'Could not fetch current location.');
            }
            throw error;
        }
    }, [map]);

    useEffect(() => {
        updateDriverLocation({ quiet: true }).catch(() => { });
    }, [updateDriverLocation]);

    const hydrateDriverState = useCallback(async () => {
        const [response, templateResponse] = await Promise.all([
            getCurrentDriver(),
            getDriverDocumentTemplates().catch(() => null),
        ]);
        const driver = response?.data?.data || response?.data || response;
        const savedCoords = driver?.location?.coordinates;

        setVehicleIconType(driver?.vehicleIconType || driver?.vehicleType || 'car');
        setVehicleIconUrl(driver?.vehicleIconUrl || '');
        setIsOnline(Boolean(driver?.isOnline));
        if (driver?.workMode) setWorkMode(driver.workMode);
        if (Array.isArray(driver?.serviceCapabilities)) setServiceCapabilities(driver.serviceCapabilities);
        setIsOwnerManagedDriver(isOwnerManagedDriverProfile(driver));
        setTodaySummary(normalizeTodaySummary(driver?.todaySummary));
        if (driver?.wallet) {
            setWalletSummary(driver.wallet);
        }
        setOnlineSelfie(driver?.onlineSelfie || null);
        setDriverDocuments(driver?.documents || {});
        setRouteBookingPreferences(writeRouteBookingPreferences(normalizeRouteBookingPreferences(driver?.routeBooking)));
        const nextVehicleApprovalPending = isDriverVehicleApprovalPending(driver);
        setVehicleReapprovalPending(nextVehicleApprovalPending);
        if (nextVehicleApprovalPending) {
            localStorage.setItem(DRIVER_VEHICLE_REAPPROVAL_PENDING_KEY, 'true');
        } else {
            localStorage.removeItem(DRIVER_VEHICLE_REAPPROVAL_PENDING_KEY);
        }
        const templateResults = templateResponse?.data?.data?.results || templateResponse?.data?.results || [];
        setDocumentTemplates(Array.isArray(templateResults) ? templateResults : []);

        const storedDriverInfoSnapshot = readStoredDriverInfo();
        persistStoredDriverInfo({
            owner_id: driver?.owner_id || storedDriverInfoSnapshot?.owner_id || null,
            vehicleIconType: driver?.vehicleIconType || storedDriverInfoSnapshot?.vehicleIconType || '',
            vehicleType: driver?.vehicleType || storedDriverInfoSnapshot?.vehicleType || '',
            vehicleIconUrl: driver?.vehicleIconUrl || storedDriverInfoSnapshot?.vehicleIconUrl || '',
        });

        if (Array.isArray(savedCoords) && savedCoords.length === 2) {
            driverCoordsRef.current = savedCoords;
            setDriverCoords(savedCoords);
            persistStoredDriverInfo({
                location: {
                    coordinates: savedCoords,
                },
                coordinates: savedCoords,
            });
        }

        return driver;
    }, []);

    const refreshTodaySummary = useCallback(async () => {
        const response = await getCurrentDriver();
        const driver = response?.data?.data || response?.data || response;

        setTodaySummary(normalizeTodaySummary(driver?.todaySummary));
        if (driver?.wallet) {
            setWalletSummary(driver.wallet);
        }

        return driver;
    }, []);

    const expiredDocumentNames = useMemo(() => {
        const flattenedTemplates = Array.isArray(documentTemplates)
            ? documentTemplates.flatMap((template) =>
                Array.isArray(template?.fields)
                    ? template.fields.map((field) => ({
                        key: field?.key,
                        label: field?.label || field?.name || field?.key || 'Document',
                        hasExpiryDate: Boolean(template?.has_expiry_date),
                    }))
                    : [],
            )
            : [];

        return flattenedTemplates
            .filter((field) => field.key && field.hasExpiryDate)
            .filter((field) => isExpiredDateValue(getDocumentExpiryValue(driverDocuments?.[field.key])))
            .map((field) => field.label);
    }, [documentTemplates, driverDocuments]);

    const rejectedDocumentNotes = useMemo(() => {
        const flattenedTemplates = Array.isArray(documentTemplates)
            ? documentTemplates.flatMap((template) =>
                Array.isArray(template?.fields)
                    ? template.fields.map((field) => ({
                        key: field?.key,
                        label: field?.label || field?.name || field?.key || 'Document',
                    }))
                    : [],
            )
            : [];

        return flattenedTemplates
            .map((field) => {
                const document = driverDocuments?.[field.key];
                const reviewStatus = getDocumentReviewStatus(document);
                if (!['rejected', 'declined'].includes(reviewStatus)) {
                    return null;
                }

                return {
                    label: field.label,
                    reason: getDocumentReason(document),
                };
            })
            .filter(Boolean);
    }, [documentTemplates, driverDocuments]);

    useEffect(() => {
        let active = true;

        setIsHydratingDriver(true);

        (async () => {
            try {
                const [dRes, activeRide] = await Promise.allSettled([
                    hydrateDriverState(),
                    fetchActiveJob('ride')
                ]);







                if (!active) {
                    return;
                }

                const ridePayload =
                    activeRide.status === 'fulfilled' ? activeRide.value : null;

                const currentJob = ridePayload?.rideId ? ridePayload : null;

                if (currentJob?.rideId) {
                    const currentType = normalizeJobType(currentJob);

                    openActiveJob(currentJob);
                    return;
                }
            } catch {
                if (active) {
                    setStatusMessage('Could not restore driver status.');
                }
            } finally {
                if (active) {
                    setIsHydratingDriver(false);
                }
            }
        })();

        return () => {
            active = false;
        };
    }, [fetchActiveJob, hydrateDriverState, navigate, openActiveJob]);

    useEffect(() => {
        let intervalId;
        let cancelled = false;

        const syncSummary = async () => {
            try {
                await refreshTodaySummary();
            } catch {
                if (!cancelled) {
                    console.warn('[driver-home] failed to refresh today summary');
                }
            }
        };

        syncSummary();
        intervalId = setInterval(syncSummary, isOnline ? 30000 : 120000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                syncSummary();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isOnline, refreshTodaySummary]);

    useEffect(() => {
        if (map && driverCoords) {
            map.panTo(toLatLng(driverCoords));
        }
    }, [map, driverCoords]);

    const recenterMap = useCallback(async () => {
        try {
            setStatusMessage('Recentering map...');
            await updateDriverLocation({ quiet: true });
            setStatusMessage('Map recentered to your location.');
        } catch (error) {
            setStatusMessage(error.message || 'Could not recenter map.');
        }
    }, [updateDriverLocation]);

    const goOnline = useCallback(async (selfieImageUrl = '') => {
        if (vehicleReapprovalPending) {
            setStatusMessage('Vehicle update is pending admin approval. Please wait before going online.');
            return;
        }

        if (walletAlertState.isBlocked) {
            setShowLowBalanceModal(true);
            setStatusMessage(
                walletAlertState.belowMinimumBalance
                    ? 'Minimum wallet balance is not maintained. Please top up to go online.'
                    : 'Cash limit exceeded. Please top up your wallet to go online.',
            );
            return;
        }

        if (expiredDocumentNames.length > 0) {
            setStatusMessage(`Please reupload expired documents: ${expiredDocumentNames.join(', ')}.`);
            return;
        }

        if (rejectedDocumentNotes.length > 0) {
            const firstRejected = rejectedDocumentNotes[0];
            setStatusMessage(
                firstRejected?.reason
                    ? `${firstRejected.label} was rejected: ${firstRejected.reason}`
                    : `Please reupload rejected documents: ${rejectedDocumentNotes.map((item) => item.label).join(', ')}.`,
            );
            return;
        }

        setIsTogglingDuty(true);
        try {
            console.info('[driver-home] goOnline requested');
            setStatusMessage('Going online...');

            // OPTIMIZATION: Use last known coords to speed up the transition
            // instead of waiting for a fresh GPS lock (which can take 2-6 seconds)
            let coordinates = Array.isArray(routeBookingPreferences.coordinates) && routeBookingPreferences.enabled
                ? routeBookingPreferences.coordinates
                : driverCoordsRef.current;

            if (!coordinates) {
                // If we really don't have any coords yet, we MUST wait for them once
                coordinates = await updateDriverLocation({ quiet: true });
            } else if (!routeBookingPreferences.enabled) {
                // Refresh location in background for better accuracy without blocking the UI
                updateDriverLocation({ quiet: true }).catch(() => { });
            }

            console.info('[driver-home] using coordinates for online status', coordinates);
            const socket = socketService.connect({ role: 'driver' });

            if (!socket) {
                console.warn('[driver-home] socket connect skipped because token was missing');
                setIsOnline(false);
                setStatusMessage('Driver session missing. Please login again.');
                return;
            }

            setIsOnline(true);
            const response = await api.patch('/drivers/online', {
                location: coordinates,
                ...(selfieImageUrl ? { selfieImageUrl } : {}),
            });
            const driver = response?.data?.data || response?.data || response;
            console.info('[driver-home] online API response', {
                isOnline: driver?.isOnline,
                zoneId: driver?.zoneId || null,
                vehicleTypeId: driver?.vehicleTypeId || null,
            });
            setIsOnline(Boolean(driver?.isOnline));
            setVehicleIconUrl((current) => driver?.vehicleIconUrl || current);
            setOnlineSelfie(driver?.onlineSelfie || null);

            // Sync current state with server response
            const finalCoords = (Array.isArray(driver?.location?.coordinates) && driver.location.coordinates.length === 2)
                ? driver.location.coordinates
                : coordinates;

            driverCoordsRef.current = finalCoords;
            setDriverCoords(finalCoords);
            persistStoredDriverInfo({
                location: {
                    coordinates: finalCoords,
                },
                coordinates: finalCoords,
            });
            socketService.emit('locationUpdate', { coordinates: finalCoords });

            setStatusMessage(
                routeBookingPreferences.enabled
                    ? 'You are online. Matching rides from your selected route area.'
                    : 'You are online. Waiting for nearby bookings.',
            );
            refreshTodaySummary().catch(() => { });
        } catch (error) {
            console.error('[driver-home] goOnline failed', error);
            setIsOnline(false);
            socketService.disconnect();
            const nextMessage = error?.response?.data?.message || error.message || 'Could not go online.';
            setStatusMessage(nextMessage);
            if (String(nextMessage).toLowerCase().includes('selfie is required')) {
                setShowOnlineSelfiePrompt(true);
            }
        } finally {
            setIsTogglingDuty(false);
        }
    }, [expiredDocumentNames, refreshTodaySummary, routeBookingPreferences.coordinates, routeBookingPreferences.enabled, updateDriverLocation, vehicleReapprovalPending, walletAlertState]);

    const goOffline = useCallback(async () => {
        setIsTogglingDuty(true);
        setIsOnline(false);
        try {
            setStatusMessage('Going offline...');
            const response = await api.patch('/drivers/offline');
            const driver = response?.data?.data || response?.data || response;
            setIsOnline(Boolean(driver?.isOnline));
            setIsOnline(false);
            setShowRequest(false);
            setCurrentRequest(null);
            setStatusMessage('You are offline.');
            socketService.disconnect();
            refreshTodaySummary().catch(() => { });
        } catch (error) {
            setIsOnline(true);
            setStatusMessage(error.message || 'Could not go offline.');
        } finally {
            setIsTogglingDuty(false);
        }
    }, [refreshTodaySummary]);

    const stopSelfieCameraStream = useCallback(() => {
        if (selfieStreamRef.current) {
            selfieStreamRef.current.getTracks().forEach((track) => track.stop());
            selfieStreamRef.current = null;
        }
    }, []);

    const handleDutyToggle = useCallback(() => {
        const now = Date.now();
        if (now - lastDutyToggleAtRef.current < 600) {
            return;
        }
        lastDutyToggleAtRef.current = now;

        if (isTogglingDuty) {
            return;
        }

        setStatusMessage(isOnline ? 'Preparing to go offline...' : 'Checking online requirements...');

        if (isOnline) {
            setShowOfflineConfirm(true);
            return;
        }

        if (vehicleReapprovalPending) {
            setStatusMessage('Vehicle update is pending admin approval. Please wait before going online.');
            return;
        }

        if (walletAlertState.isBlocked) {
            setShowLowBalanceModal(true);
            setStatusMessage(
                walletAlertState.belowMinimumBalance
                    ? 'Minimum wallet balance is not maintained. Please top up to go online.'
                    : 'Cash limit exceeded. Please top up your wallet to go online.',
            );
            return;
        }

        if (expiredDocumentNames.length > 0) {
            setStatusMessage(`Please reupload expired documents: ${expiredDocumentNames.join(', ')}.`);
            return;
        }

        if (rejectedDocumentNotes.length > 0) {
            const firstRejected = rejectedDocumentNotes[0];
            setStatusMessage(
                firstRejected?.reason
                    ? `${firstRejected.label} was rejected: ${firstRejected.reason}`
                    : `Please reupload rejected documents: ${rejectedDocumentNotes.map((item) => item.label).join(', ')}.`,
            );
            return;
        }

        if (hasSelfieForToday(onlineSelfie)) {
            goOnline();
            return;
        }

        setSelfieError('');
        setShowSelfieCameraCapture(false);
        stopSelfieCameraStream();
        setShowOnlineSelfiePrompt(true);
    }, [
        expiredDocumentNames,
        goOnline,
        isOnline,
        isTogglingDuty,
        onlineSelfie,
        rejectedDocumentNotes,
        stopSelfieCameraStream,
        vehicleReapprovalPending,
        walletAlertState,
    ]);

    const uploadSelfieDataUrl = useCallback(async (sourceDataUrl) => {
        setSelfieUploading(true);
        setSelfieError('');

        try {
            setStatusMessage('Processing selfie...');
            const compressedDataUrl = await compressSelfieDataUrl(sourceDataUrl);
            const imageBlob = await dataUrlToBlob(compressedDataUrl);
            const imageFile = new File([imageBlob], `selfie-${Date.now()}.jpg`, {
                type: imageBlob.type || 'image/jpeg',
            });

            setStatusMessage('Uploading selfie...');
            const uploadResult = await uploadService.uploadImageFile(imageFile, 'driver-online-selfies');
            const selfieUrl = uploadResult?.url || uploadResult?.secureUrl || '';

            if (!selfieUrl) {
                throw new Error('Selfie upload did not return an image URL');
            }

            setOnlineSelfie({
                imageUrl: selfieUrl,
                capturedAt: new Date().toISOString(),
                forDate: new Date().toISOString().slice(0, 10),
            });
            setShowSelfieCameraCapture(false);
            setShowOnlineSelfiePrompt(false);
            stopSelfieCameraStream();
            await goOnline(selfieUrl);
        } catch (error) {
            setSelfieError(error?.message || 'Failed to upload selfie');
            setStatusMessage(error?.message || 'Failed to upload selfie');
        } finally {
            setSelfieUploading(false);
            if (selfieCameraInputRef.current) {
                selfieCameraInputRef.current.value = '';
            }
        }
    }, [goOnline, stopSelfieCameraStream]);

    const openSelfieCamera = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            selfieCameraInputRef.current?.click();
            return;
        }

        try {
            setSelfieError('');
            setStatusMessage('Opening camera...');
            stopSelfieCameraStream();
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
                audio: false,
            });

            selfieStreamRef.current = stream;
            setShowSelfieCameraCapture(true);
        } catch (error) {
            const message = error?.message || 'Could not access the camera.';
            setSelfieError(message);
            setStatusMessage(message);
            selfieCameraInputRef.current?.click();
        }
    }, [stopSelfieCameraStream]);

    useEffect(() => {
        if (!showSelfieCameraCapture || !selfieVideoRef.current || !selfieStreamRef.current) {
            return;
        }

        const video = selfieVideoRef.current;
        video.srcObject = selfieStreamRef.current;
        video.play().catch(() => { });
    }, [showSelfieCameraCapture]);

    const captureSelfieFromCamera = useCallback(async () => {
        const video = selfieVideoRef.current;
        if (!video) {
            setSelfieError('Camera preview is not ready yet.');
            return;
        }

        const width = video.videoWidth || 720;
        const height = video.videoHeight || 1280;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        if (!context) {
            setSelfieError('Could not capture selfie frame.');
            return;
        }

        context.drawImage(video, 0, 0, width, height);
        const snapshot = canvas.toDataURL('image/jpeg', 0.9);
        await uploadSelfieDataUrl(snapshot);
    }, [uploadSelfieDataUrl]);

    const handleSelfieSelected = useCallback(async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const base64Image = await compressSelfieForUpload(file);
        await uploadSelfieDataUrl(base64Image);
    }, [uploadSelfieDataUrl]);

    useEffect(() => () => {
        stopSelfieCameraStream();
    }, [stopSelfieCameraStream]);

    const recoverRealtimeSession = useCallback(async ({ reason = 'resume' } = {}) => {
        if (!isOnline || isHydratingDriver || isTogglingDuty) {
            return;
        }

        if (recoveryInFlightRef.current) {
            return;
        }

        recoveryInFlightRef.current = true;

        try {
            const socket = socketService.connect({ role: 'driver' });

            if (!socket) {
                return;
            }

            let nextCoords = driverCoordsRef.current;

            if (!nextCoords) {
                try {
                    nextCoords = await updateDriverLocation({ quiet: true });
                } catch {
                    nextCoords = driverCoordsRef.current;
                }
            }

            if (nextCoords) {
                socketService.emit('locationUpdate', { coordinates: nextCoords });
            }

            try {
                const [activeRide] = await Promise.allSettled([
                    fetchActiveJob('ride'),
                ]);
                const ridePayload = activeRide.status === 'fulfilled' ? activeRide.value : null;
                const currentJob = ridePayload?.rideId ? ridePayload : null;

                if (currentJob?.rideId) {
                    openActiveJob(currentJob);
                    return;
                }
            } catch {
                // Realtime recovery should continue even if active-job hydration fails.
            }

            setStatusMessage(
                reason === 'visibility'
                    ? 'Realtime connection refreshed.'
                    : 'Driver session synced.',
            );
        } finally {
            recoveryInFlightRef.current = false;
        }
    }, [fetchActiveJob, isHydratingDriver, isOnline, isTogglingDuty, openActiveJob, updateDriverLocation]);

    const scheduleRecoveryBurst = useCallback(({ reason = 'resume' } = {}) => {
        if (!isOnline || isHydratingDriver || isTogglingDuty) {
            return;
        }

        clearRecoveryBurst();

        [0, 1500, 5000, 10000].forEach((delay, index) => {
            const timeoutId = window.setTimeout(() => {
                recoverRealtimeSession({
                    reason: index === 0 ? reason : `${reason}-retry-${index}`,
                }).catch(() => { });
            }, delay);

            recoveryTimeoutsRef.current.push(timeoutId);
        });
    }, [clearRecoveryBurst, isHydratingDriver, isOnline, isTogglingDuty, recoverRealtimeSession]);

    // Socket Integration
    useEffect(() => {
        if (isOnline) {
            console.info('[driver-home] socket effect starting for online driver');
            const socket = socketService.connect({ role: 'driver' });

            if (!socket) {
                console.warn('[driver-home] socket effect could not get a socket');
                setStatusMessage('Driver session missing. Please login again.');
                setIsOnline(false);
                setSocketStatus('offline');
                return undefined;
            }

            setSocketStatus(socket.connected ? 'connected' : 'reconnecting');

            if (driverCoordsRef.current) {
                socketService.emit('locationUpdate', { coordinates: driverCoordsRef.current });
                console.info('[driver-home] emitted initial locationUpdate from effect', driverCoordsRef.current);
            }

            const onSocketConnect = () => {
                clearRecoveryBurst();
                setSocketStatus('connected');
            };
            const onSocketDisconnect = () => {
                setSocketStatus('offline');
                scheduleRecoveryBurst({ reason: 'disconnect' });
            };
            const onSocketReconnectAttempt = () => setSocketStatus('reconnecting');
            const onSocketConnectError = () => {
                setSocketStatus('reconnecting');
                scheduleRecoveryBurst({ reason: 'connect-error' });
            };

            const onRideRequest = (data) => {
                console.info('[driver-home] rideRequest received', data);
                const requestType = normalizeJobType(data);
                const request = {
                    type: requestType,
                    title: getJobTitle(requestType),
                    fare: `Rs ${data.fare || 0}`,
                    payment: data.paymentMethod || 'Cash',
                    pickup: data.pickupAddress || formatPoint(data.pickupLocation, 'Pickup Location'),
                    drop: data.dropAddress || formatPoint(data.dropLocation, 'Drop Location'),
                    distance: formatTripDistance(data),
                    requestId: data.rideId,
                    rideId: data.rideId,
                    acceptRejectDurationSeconds: data.acceptRejectDurationSeconds || data.expiresInSeconds,
                    bookingMode: data.bookingMode || 'normal',
                    bidding: data.bidding || { enabled: false },
                    raw: data,
                };
                setCurrentRequest(request);
                setShowRequest(true);
                playRideRequestAlertSound();
                setStatusMessage('New booking received.');
            };

            const onRideRequestClosed = ({ rideId, reason, message }) => {
                console.info('[driver-home] rideRequestClosed received', { rideId, reason, message });
                if (acceptingRideIdRef.current && acceptingRideIdRef.current === rideId) {
                    return;
                }
                const activeRequest = currentRequestRef.current;
                if (!activeRequest?.rideId || activeRequest.rideId === rideId) {
                    setShowRequest(false);
                    setCurrentRequest(null);
                    stopRideRequestAlertSound();
                    if (reason === 'user-cancelled') {
                        setStatusMessage(message || 'User cancelled the ride.');
                    } else if (reason === 'deleted-by-admin') {
                        setStatusMessage('Ride was cancelled by admin.');
                    } else if (reason === 'unmatched') {
                        setStatusMessage('Ride request expired without a match.');
                    }
                }
            };

            const onSocketError = ({ message }) => {
                console.error('[driver-home] socket errorMessage received', message);
                setStatusMessage(message || 'Socket error.');
                if (String(message || '').toLowerCase().includes('no longer available')) {
                    setShowRequest(false);
                    setCurrentRequest(null);
                    stopRideRequestAlertSound();
                }
                acceptingRideIdRef.current = '';
                setAcceptingRideId('');
            };

            const onRideBidSubmitted = ({ rideId }) => {
                if (!rideId || rideId !== acceptingRideIdRef.current) {
                    return;
                }

                setAcceptingRideId('');
                setStatusMessage('Bid submitted. Waiting for rider response.');
            };

            const onRideBiddingUpdated = (payload = {}) => {
                if (!payload?.rideId) {
                    return;
                }

                setCurrentRequest((current) => {
                    if (!current?.rideId || current.rideId !== payload.rideId) {
                        return current;
                    }

                    const pricingNegotiationMode = payload.pricingNegotiationMode || current.raw?.pricingNegotiationMode || 'none';
                    const isDriverBidMode = pricingNegotiationMode === 'driver_bid';

                    return {
                        ...current,
                        fare: `Rs ${payload.fare || current.raw?.fare || 0}`,
                        bookingMode: payload.bookingMode || current.bookingMode || 'normal',
                        raw: {
                            ...(current.raw || {}),
                            fare: payload.fare || current.raw?.fare || 0,
                            bookingMode: payload.bookingMode || current.raw?.bookingMode || 'bidding',
                            pricingNegotiationMode,
                            fareIncreaseWaitMinutes: payload.fareIncreaseWaitMinutes || current.raw?.fareIncreaseWaitMinutes || 0,
                            nextFareIncreaseAt: payload.nextFareIncreaseAt || current.raw?.nextFareIncreaseAt || null,
                            bidding: {
                                ...(current.raw?.bidding || {}),
                                enabled: isDriverBidMode,
                                baseFare: payload.baseFare || current.raw?.bidding?.baseFare || current.raw?.baseFare || current.raw?.fare || 0,
                                userMaxBidFare: payload.userMaxBidFare || payload.fare || current.raw?.bidding?.userMaxBidFare || current.raw?.userMaxBidFare || 0,
                                bidStepAmount: payload.bidStepAmount || current.raw?.bidding?.bidStepAmount || 10,
                            },
                        },
                    };
                });
            };

            const openAcceptedRide = async (payload) => {
                if (!payload?.rideId || payload.rideId !== acceptingRideIdRef.current) {
                    return;
                }

                const activeRequest = currentRequestRef.current;
                const nextType = activeRequest?.type || 'ride';
                const scheduledAt = activeRequest?.raw?.scheduledAt || payload?.scheduledAt || null;
                let currentJob = null;

                try {
                    currentJob = await fetchActiveJob(nextType);
                } catch {
                    currentJob = null;
                }

                setShowRequest(false);
                stopRideRequestAlertSound();
                acceptingRideIdRef.current = '';
                setAcceptingRideId('');
                if (isScheduledRideForFuture(scheduledAt)) {
                    setStatusMessage(`Scheduled ride confirmed for ${formatScheduledDateTime(scheduledAt)}.`);
                    loadScheduledRides();
                    return;
                }

                navigate('/taxi/driver/active-trip', {
                    state: {
                        type: nextType,
                        rideId: currentJob?.rideId || payload.rideId,
                        otp: currentJob?.otp || payload?.otp || activeRequest?.raw?.otp || '',
                        request: {
                            ...activeRequest,
                            rideId: currentJob?.rideId || payload.rideId,
                            otp: currentJob?.otp || payload?.otp || activeRequest?.raw?.otp || '',
                            raw: currentJob || {
                                ...(activeRequest?.raw || {}),
                                otp: payload?.otp || activeRequest?.raw?.otp || '',
                                status: payload.status,
                                liveStatus: payload.liveStatus,
                                acceptedAt: payload.acceptedAt,
                            },
                        },
                        currentDriverCoords: driverCoordsRef.current || readStoredDriverCoords() || null,
                    },
                });
            };

            const onWalletUpdated = (payload) => {
                if (payload?.wallet) {
                    setWalletSummary(payload.wallet);

                    const nextWalletAlertState = getWalletAlertState(payload.wallet, {
                        ignoreRestrictions: isOwnerManagedDriver,
                    });

                    if (nextWalletAlertState.isBlocked) {
                        setShowRequest(false);
                        setCurrentRequest(null);
                        stopRideRequestAlertSound();
                        setShowLowBalanceModal(true);
                        setStatusMessage(
                            nextWalletAlertState.belowMinimumBalance
                                ? 'Minimum wallet balance is not maintained. Top up to receive new ride requests.'
                                : 'Cash limit exceeded. Top up to receive new ride requests.',
                        );
                    } else if (nextWalletAlertState.isWarning) {
                        setShowLowBalanceModal(true);
                        setStatusMessage('Available cash limit is getting low. Top up soon.');
                    }
                }

                if (payload?.notification) {
                    addLocalDriverNotification({
                        id: payload.notification.id || `wallet-${Date.now()}`,
                        title: payload.notification.title || 'Payment received',
                        body: payload.notification.body || 'A rider payment was received.',
                        sentAt: payload.notification.sentAt || new Date().toISOString(),
                        source: 'wallet_event',
                    });
                    refreshNotificationCount();
                }
            };

            socketService.on('rideRequest', onRideRequest);
            socketService.on('rideRequestClosed', onRideRequestClosed);
            socketService.on('errorMessage', onSocketError);
            socketService.on('rideAccepted', openAcceptedRide);
            socketService.on('rideBidSubmitted', onRideBidSubmitted);
            socketService.on('rideBiddingUpdated', onRideBiddingUpdated);
            socketService.on('driver:wallet:updated', onWalletUpdated);
            console.info('[driver-home] socket listeners registered');
            socket.on('connect', onSocketConnect);
            socket.on('disconnect', onSocketDisconnect);
            socket.on('connect_error', onSocketConnectError);
            socket.io.on('reconnect_attempt', onSocketReconnectAttempt);

            const locationInterval = setInterval(() => {
                getCurrentCoords({ purpose: 'background' })
                    .then((coordinates) => {
                        driverCoordsRef.current = coordinates;
                        setDriverCoords(coordinates);
                        persistStoredDriverInfo({
                            location: {
                                coordinates,
                            },
                            coordinates,
                        });
                        socketService.emit('locationUpdate', { coordinates });
                        console.info('[driver-home] periodic locationUpdate emitted', coordinates);
                    })
                    .catch((error) => {
                        console.warn('[driver-home] periodic location update skipped', error?.message || error);
                        setStatusMessage(error.message || 'Could not update live location.');
                    });
            }, 10000);

            return () => {
                console.info('[driver-home] cleaning up socket listeners');
                socketService.off('rideRequest', onRideRequest);
                socketService.off('rideRequestClosed', onRideRequestClosed);
                socketService.off('errorMessage', onSocketError);
                socketService.off('rideAccepted', openAcceptedRide);
                socketService.off('rideBidSubmitted', onRideBidSubmitted);
                socketService.off('rideBiddingUpdated', onRideBiddingUpdated);
                socketService.off('driver:wallet:updated', onWalletUpdated);
                socket.off('connect', onSocketConnect);
                socket.off('disconnect', onSocketDisconnect);
                socket.off('connect_error', onSocketConnectError);
                socket.io.off('reconnect_attempt', onSocketReconnectAttempt);
                clearInterval(locationInterval);
            };
        } else {
            console.info('[driver-home] driver offline, disconnecting socket');
            clearRecoveryBurst();
            setSocketStatus('offline');
            socketService.disconnect();
        }
        return undefined;
    }, [clearRecoveryBurst, fetchActiveJob, isOnline, isOwnerManagedDriver, loadScheduledRides, navigate, scheduleRecoveryBurst]);

    useEffect(() => {
        if (!isOnline) {
            return undefined;
        }

        const handleVisibilityRecovery = () => {
            if (document.visibilityState === 'visible') {
                scheduleRecoveryBurst({ reason: 'visibility' });
            }
        };

        const handleWindowFocus = () => {
            scheduleRecoveryBurst({ reason: 'focus' });
        };

        const handlePageShow = () => {
            scheduleRecoveryBurst({ reason: 'pageshow' });
        };

        const handleNetworkOnline = () => {
            scheduleRecoveryBurst({ reason: 'network' });
        };

        document.addEventListener('visibilitychange', handleVisibilityRecovery);
        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('pageshow', handlePageShow);
        window.addEventListener('online', handleNetworkOnline);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityRecovery);
            window.removeEventListener('focus', handleWindowFocus);
            window.removeEventListener('pageshow', handlePageShow);
            window.removeEventListener('online', handleNetworkOnline);
        };
    }, [isOnline, scheduleRecoveryBurst]);

    useEffect(() => {
        if (!isOnline) {
            return undefined;
        }

        const healthCheckInterval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') {
                return;
            }

            if (!socketService.isConnected()) {
                setSocketStatus('reconnecting');
                scheduleRecoveryBurst({ reason: 'health-check' });
            }
        }, 8000);

        return () => {
            clearInterval(healthCheckInterval);
        };
    }, [isOnline, scheduleRecoveryBurst]);

    useEffect(() => {
        if (!isOnline) {
            delete window.__driverReconnectRealtime;
            return undefined;
        }

        window.__driverReconnectRealtime = () => scheduleRecoveryBurst({ reason: 'flutter-resume' });

        return () => {
            delete window.__driverReconnectRealtime;
        };
    }, [isOnline, scheduleRecoveryBurst]);

    const liveActiveSeconds = Math.max(0, Number(todaySummary.activeSeconds || 0));
    const dutyHours = Math.floor(liveActiveSeconds / 3600);
    const dutyMins = Math.floor((liveActiveSeconds % 3600) / 60);

    const handleAccept = () => {
        if (!currentRequest?.rideId || acceptingRideId) {
            return;
        }

        acceptingRideIdRef.current = currentRequest.rideId;
        setAcceptingRideId(currentRequest.rideId);
        setStatusMessage('Accepting ride...');
        stopRideRequestAlertSound();
        socketService.emit('acceptRide', { rideId: currentRequest.rideId });
    };

    const handleDecline = () => {
        if (currentRequest?.rideId) {
            socketService.emit('rejectRide', { rideId: currentRequest.rideId });
        }
        stopRideRequestAlertSound();
        setShowRequest(false);
    };

    const handleSubmitBid = (bidFare) => {
        if (!currentRequest?.rideId || acceptingRideId || currentRequest?.raw?.pricingNegotiationMode !== 'driver_bid') {
            return;
        }

        acceptingRideIdRef.current = currentRequest.rideId;
        setAcceptingRideId(currentRequest.rideId);
        setStatusMessage('Submitting bid...');
        stopRideRequestAlertSound();
        socketService.emit('submitRideBid', { rideId: currentRequest.rideId, bidFare });
    };

    return (
        <div className="h-[100dvh] w-full bg-[#E5E7EB] font-sans select-none overflow-hidden relative text-slate-900 border-x border-slate-200 shadow-2xl max-w-md mx-auto">
            {/* Overlay for Ride Request Modal */}
            <IncomingRideRequest
                visible={showRequest && Boolean(currentRequest)}
                requestData={currentRequest}
                isAccepting={Boolean(acceptingRideId)}
                onAccept={handleAccept}
                onDecline={handleDecline}
                onSubmitBid={handleSubmitBid}
            />
            <IncomingRideRequest
                visible={Boolean(selectedScheduledRide)}
                requestData={selectedScheduledRide}
                mode="preview"
                onPreviewCancel={handleCancelScheduledRide}
                isPreviewCancelling={cancellingScheduledRideId === selectedScheduledRide?.rideId}
                canPreviewCancel={Boolean(selectedScheduledRide?.isAssignedToCurrentDriver)}
                previewCancelDisabledLabel="Not assigned yet"
                previewCancelHelpText={
                    selectedScheduledRide?.isAssignedToCurrentDriver
                        ? 'Cancelling here will also notify the user immediately.'
                        : 'This scheduled request is visible to you, but only a ride already assigned to you can be cancelled from here.'
                }
                onClose={() => setSelectedScheduledRide(null)}
                onDecline={() => setSelectedScheduledRide(null)}
            />

            <LowBalanceModal
                isOpen={showLowBalanceModal}
                onClose={() => setShowLowBalanceModal(false)}
                balance={walletAlertState.balance}
                cashLimit={walletAlertState.cashLimit}
                minimumBalance={walletAlertState.minimumBalanceForOrders}
                isBlocked={walletAlertState.isBlocked}
                belowMinimumBalance={walletAlertState.belowMinimumBalance}
                cashLimitExceeded={walletAlertState.cashLimitExceeded}
            />

            {showCancelledTripModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[32px] p-8 shadow-2xl border border-slate-100/80 dark:border-slate-800 text-center relative overflow-hidden"
                    >
                        <div className="w-16 h-16 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
                            <Bell size={28} className="text-rose-500 animate-bounce" />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">Ride Cancelled</h3>
                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                            {cancelledTripMessage}
                        </p>
                        <motion.button
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setShowCancelledTripModal(false)}
                            className="w-full bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 text-white py-4 rounded-2xl text-[13px] font-bold uppercase tracking-widest shadow-lg"
                        >
                            Okay
                        </motion.button>
                    </motion.div>
                </div>
            )}

            <AnimatePresence>
                {showCompletedTripModal && completedTripDetails && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-[70] bg-slate-950/60 backdrop-blur-md"
                            onClick={() => setShowCompletedTripModal(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 100, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 100, scale: 0.95 }}
                            transition={{ type: "spring", damping: 25, stiffness: 280 }}
                            className="absolute bottom-0 left-0 right-0 z-[71] max-h-[85vh] overflow-y-auto rounded-t-[36px] border border-white/10 bg-white px-6 py-8 shadow-[0_-24px_50px_rgba(15,23,42,0.15)] backdrop-blur-lg dark:bg-slate-900 text-slate-900 dark:text-white"
                        >
                            {/* Done Header checkmark */}
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 rounded-2xl bg-emerald-500 text-white mx-auto flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
                                    <Check size={36} strokeWidth={3.5} />
                                </div>
                                <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
                                    {completedTripDetails.type === 'parcel' ? 'Delivery Completed!' : 'Ride Completed!'}
                                </h3>
                                <p className="text-[11px] font-bold text-slate-400 dark:text-slate-400 mt-1 uppercase tracking-widest">
                                    Trip successfully completed
                                </p>
                            </div>

                            {/* Earnings display */}
                            <div className="mb-6 rounded-[28px] border border-slate-100 dark:border-slate-800 bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/50 dark:to-slate-900 p-5 shadow-sm text-center">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-400">
                                    Your Net Earnings
                                </span>
                                <h2 className="mt-1 text-4xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                                    ₹{Number(completedTripDetails.driverEarnings || 0).toFixed(2)}
                                </h2>
                                <p className="mt-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                    Total Trip Earnings
                                </p>
                                
                                {String(completedTripDetails.paymentMethod || '').toLowerCase() === 'cash' ? (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/50">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Wallet Adjustment</p>
                                        <p className={`mt-1 text-sm font-black ${Number(completedTripDetails.driverEarnings) - (Number(completedTripDetails.fare) - (Number(completedTripDetails?.promo?.discount_amount) || 0)) > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {Number(completedTripDetails.driverEarnings) - (Number(completedTripDetails.fare) - (Number(completedTripDetails?.promo?.discount_amount) || 0)) > 0 ? '+' : ''}₹{(Number(completedTripDetails.driverEarnings) - (Number(completedTripDetails.fare) - (Number(completedTripDetails?.promo?.discount_amount) || 0))).toFixed(2)}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/50">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Wallet Adjustment</p>
                                        <p className="mt-1 text-sm font-black text-emerald-500">
                                            +₹{Number(completedTripDetails.driverEarnings || 0).toFixed(2)} (Added to Wallet)
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Bill details table breakdown */}
                            <div className="mb-6 overflow-hidden rounded-[24px] border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
                                <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-4 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/35">
                                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Fare Details
                                    </span>
                                    <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                        {completedTripDetails.paymentMethod}
                                    </span>
                                </div>
                                <div className="p-5 space-y-3.5">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-semibold text-slate-500 dark:text-slate-400">Base Fare</span>
                                        <span className="font-bold text-slate-900 dark:text-white">₹{Number(completedTripDetails.baseFare || 0).toFixed(2)}</span>
                                    </div>
                                    {completedTripDetails.timeCharge > 0 && (
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-semibold text-slate-500 dark:text-slate-400">Duration Time Charge</span>
                                            <span className="font-bold text-slate-900 dark:text-white">₹{Number(completedTripDetails.timeCharge || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    {completedTripDetails.waitingCharge > 0 && (
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-semibold text-slate-500 dark:text-slate-400">Waiting Charge</span>
                                            <span className="font-bold text-slate-900 dark:text-white">₹{Number(completedTripDetails.waitingCharge || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-bold text-slate-900 dark:text-white">Gross Customer Fare</span>
                                        <span className="font-bold text-slate-900 dark:text-white">₹{Number(completedTripDetails.fare || 0).toFixed(2)}</span>
                                    </div>
                                    {completedTripDetails?.promo?.discount_amount > 0 && (
                                        <div className="flex justify-between items-center text-xs text-rose-500 dark:text-rose-400">
                                            <span className="font-semibold">Promo Discount (Driver Bears)</span>
                                            <span className="font-bold">-₹{Number(completedTripDetails.promo.discount_amount || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                                    <div className="flex justify-between items-center text-[13px]">
                                        <span className="font-black text-slate-900 dark:text-white">Net Customer Fare</span>
                                        <span className="font-black text-emerald-600 dark:text-emerald-400">₹{(Number(completedTripDetails.fare || 0) - Number(completedTripDetails?.promo?.discount_amount || 0)).toFixed(2)}</span>
                                    </div>
                                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                                    {completedTripDetails.distanceCharge > 0 && (
                                        <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                                            <span className="font-semibold">Extra Distance Charge</span>
                                            <span className="font-bold text-slate-900 dark:text-white">₹{Number(completedTripDetails.distanceCharge || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    {completedTripDetails.additionalCharge > 0 && (
                                        <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                                            <span className="font-semibold">Additional Charge</span>
                                            <span className="font-bold text-slate-900 dark:text-white">₹{Number(completedTripDetails.additionalCharge || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    {completedTripDetails.adminExtraChargeAmount > 0 && (
                                        <div className="flex justify-between items-center text-xs text-amber-500 dark:text-amber-400">
                                            <span className="font-semibold">Admin Extra Charge</span>
                                            <span className="font-bold">₹{Number(completedTripDetails.adminExtraChargeAmount || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    {completedTripDetails.cancellationChargeAmount > 0 && (
                                        <div className="flex justify-between items-center text-xs text-red-500 dark:text-red-400">
                                            <span className="font-semibold">Previous Cancellation Fee (Admin)</span>
                                            <span className="font-bold">₹{Number(completedTripDetails.cancellationChargeAmount || 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-center text-xs text-rose-500 dark:text-rose-400">
                                        <span className="font-semibold">Admin Commission</span>
                                        <span className="font-bold">-₹{Number(completedTripDetails.commissionAmount || 0).toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Trip Address details */}
                            <div className="mb-6 rounded-[24px] border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 shadow-sm">
                                <div className="flex items-start gap-3">
                                    <div className="mt-1 flex flex-col items-center">
                                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                        <span className="my-1 h-8 w-px border-l border-dashed border-slate-200 dark:border-slate-700" />
                                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Pickup</p>
                                            <p className="mt-0.5 text-xs font-semibold leading-relaxed text-slate-800 dark:text-slate-200 truncate">{completedTripDetails.pickup}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Drop</p>
                                            <p className="mt-0.5 text-xs font-semibold leading-relaxed text-slate-800 dark:text-slate-200 truncate">{completedTripDetails.drop}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Done Button */}
                            <button
                                onClick={() => setShowCompletedTripModal(false)}
                                className="w-full h-14 rounded-2xl bg-slate-950 hover:bg-slate-900 dark:bg-white dark:text-slate-950 text-white font-black uppercase tracking-wider text-xs shadow-lg active:scale-98 transition-all flex items-center justify-center gap-2"
                            >
                                Done
                            </button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showOfflineConfirm && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-[70] bg-slate-950/45 backdrop-blur-sm"
                            onClick={() => setShowOfflineConfirm(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.96 }}
                            className="absolute left-1/2 top-1/2 z-[71] w-[calc(100%-2.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
                        >
                            <h3 className="text-[18px] font-black tracking-tight text-slate-950">Go offline?</h3>
                            <p className="mt-2 text-[13px] font-semibold leading-relaxed text-slate-500">
                                New ride requests will stop until you go online again.
                            </p>
                            <div className="mt-5 grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowOfflineConfirm(false)}
                                    className="h-12 rounded-[16px] border border-slate-200 bg-slate-50 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500"
                                >
                                    Stay Online
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowOfflineConfirm(false);
                                        goOffline();
                                    }}
                                    className="h-12 rounded-[16px] bg-rose-500 text-[12px] font-black uppercase tracking-[0.14em] text-white shadow-[0_14px_28px_rgba(244,63,94,0.28)]"
                                >
                                    Go Offline
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showOnlineSelfiePrompt && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-[72] bg-slate-950/50 backdrop-blur-sm"
                            onClick={() => !selfieUploading && setShowOnlineSelfiePrompt(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.96 }}
                            className="absolute left-1/2 top-1/2 z-[73] w-[calc(100%-2.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.22)]"
                        >
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Daily check-in</p>
                            <h3 className="mt-2 text-[20px] font-black tracking-tight text-slate-950">Upload today&apos;s selfie</h3>
                            <p className="mt-2 text-[13px] font-semibold leading-relaxed text-slate-500">
                                Before going online, submit a fresh selfie for today. This helps verify the driver account like Rapido-style daily check-in.
                            </p>

                            {selfieError ? (
                                <p className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-600">
                                    {selfieError}
                                </p>
                            ) : null}

                            {showSelfieCameraCapture ? (
                                <div className="mt-4 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-950">
                                    <video
                                        ref={selfieVideoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="h-64 w-full object-cover"
                                    />
                                </div>
                            ) : null}

                            <div className="mt-5 grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    disabled={selfieUploading}
                                    onClick={() => {
                                        stopSelfieCameraStream();
                                        setShowSelfieCameraCapture(false);
                                        setShowOnlineSelfiePrompt(false);
                                    }}
                                    className="h-12 px-3 rounded-[16px] border border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500 disabled:opacity-60 overflow-hidden"
                                >
                                    Cancel
                                </button>
                                {showSelfieCameraCapture ? (
                                    <button
                                        type="button"
                                        disabled={selfieUploading}
                                        onClick={captureSelfieFromCamera}
                                        className="h-12 rounded-[16px] bg-emerald-500 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-[0_14px_28px_rgba(16,185,129,0.28)] disabled:opacity-60"
                                    >
                                        {selfieUploading ? 'Uploading...' : 'Capture'}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={selfieUploading}
                                        onClick={openSelfieCamera}
                                        className="relative h-12 px-3 rounded-[16px] bg-emerald-500 text-[10px] font-black uppercase tracking-[0.08em] text-white shadow-[0_14px_28px_rgba(16,185,129,0.28)] disabled:opacity-60 overflow-hidden"
                                    >
                                        <span className="flex items-center justify-center gap-1.5 w-full">
                                            <Camera size={14} className="shrink-0" />
                                            <span className="truncate">Take New Selfie</span>
                                        </span>
                                        <input
                                            ref={selfieCameraInputRef}
                                            type="file"
                                            accept="image/*"
                                            capture="user"
                                            disabled={selfieUploading}
                                            className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
                                            onChange={handleSelfieSelected}
                                        />
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isScheduleSheetOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-[74] bg-slate-950/45 backdrop-blur-sm"
                            onClick={() => setIsScheduleSheetOpen(false)}
                        />
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                            className="absolute inset-x-0 bottom-0 z-[75] max-h-[78vh] rounded-t-[30px] border border-white/70 bg-white px-5 pb-6 pt-5 shadow-[0_-24px_60px_rgba(15,23,42,0.24)]"
                        >
                            <div className="mx-auto h-1.5 w-14 rounded-full bg-slate-200" />
                            <div className="mt-4 flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">Schedule</p>
                                    <h3 className="mt-1 text-[22px] font-black tracking-tight text-slate-950">Scheduled rides</h3>
                                    <p className="mt-1 text-[12px] font-semibold text-slate-500">Upcoming scheduled requests available for this driver.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsScheduleSheetOpen(false)}
                                    className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 active:scale-95"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="mt-4 max-h-[58vh] overflow-y-auto space-y-3 pr-1">
                                {isScheduleLoading ? (
                                    Array.from({ length: 3 }).map((_, index) => (
                                        <div key={index} className="animate-pulse rounded-[22px] border border-slate-100 bg-slate-50 px-4 py-4">
                                            <div className="h-3 w-1/2 rounded-full bg-slate-200" />
                                            <div className="mt-3 h-2.5 w-full rounded-full bg-slate-100" />
                                            <div className="mt-2 h-2.5 w-4/5 rounded-full bg-slate-100" />
                                        </div>
                                    ))
                                ) : scheduledRides.length === 0 ? (
                                    <div className="rounded-[24px] border border-slate-100 bg-slate-50 px-5 py-10 text-center">
                                        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-white text-slate-300 shadow-sm">
                                            <CalendarClock size={28} strokeWidth={1.8} />
                                        </div>
                                        <p className="mt-4 text-[16px] font-black text-slate-700">No scheduled rides yet</p>
                                        <p className="mt-1 text-[12px] font-bold text-slate-400">Scheduled bookings will show here when they are assigned.</p>
                                    </div>
                                ) : (
                                    scheduledRides.map((ride) => (
                                        <button
                                            key={ride.rideId}
                                            type="button"
                                            onClick={() => setSelectedScheduledRide(createScheduledRidePreview(ride))}
                                            className="w-full rounded-[22px] border border-slate-100 bg-slate-50 px-4 py-4 text-left shadow-sm transition-all active:scale-[0.99]"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-blue-100 text-blue-600">
                                                    <CalendarClock size={18} strokeWidth={2.2} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-[14px] font-black text-slate-950">
                                                                {ride.type === 'parcel' ? 'Scheduled delivery' : ride.type === 'intercity' ? 'Scheduled intercity ride' : 'Scheduled ride'}
                                                            </p>
                                                            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-500">
                                                                {formatScheduledDateTime(ride.scheduledAt)}
                                                            </p>
                                                            <p className="mt-1 text-[11px] font-black text-emerald-600">
                                                                {getScheduledRideCountdown(ride.scheduledAt, scheduleNow)}
                                                            </p>
                                                        </div>
                                                        <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                                                            {formatFareLabel(ride.fare || ride.baseFare)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-3 text-[11px] font-bold text-slate-500 line-clamp-1">
                                                        {ride.user?.name || 'Customer'}{ride.user?.phone ? ` • ${ride.user.phone}` : ''}
                                                    </p>
                                                    <p className="mt-2 text-[11px] font-bold text-slate-700 line-clamp-1">
                                                        Pickup: {ride.pickupAddress || 'Pickup point'}
                                                    </p>
                                                    <p className="mt-1 text-[11px] font-bold text-slate-700 line-clamp-1">
                                                        Drop: {ride.dropAddress || 'Drop point'}
                                                    </p>
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* --- TOP FLOATING UI --- */}
            {/* --- TOP FLOATING UI --- */}
            <div className="fixed top-0 left-0 right-0 z-40 mx-auto max-w-md grid grid-cols-3 items-center p-4 pt-12 pointer-events-none">
                {/* Left Side: Actions */}
                <div className="pointer-events-auto flex items-center gap-2">
                    <button
                        onClick={() => {
                            loadScheduledRides();
                            setIsScheduleSheetOpen(true);
                        }}
                        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-100 bg-white text-slate-900 shadow-md transition-all active:scale-90"
                    >
                        <CalendarClock size={18} />
                        {scheduledRideCount > 0 ? (
                            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-white bg-blue-600 px-1 text-[8px] font-black text-white shadow-sm">
                                {scheduledRideCount > 99 ? '99+' : scheduledRideCount}
                            </span>
                        ) : null}
                    </button>

                    <button
                        onClick={() => navigate('/taxi/driver/notifications')}
                        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-100 bg-white text-slate-900 shadow-md transition-all active:scale-90"
                    >
                        <Bell size={18} />
                        {notificationCount > 0 ? (
                            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-white bg-rose-500 px-1 text-[8px] font-black text-white shadow-sm">
                                {notificationCount > 99 ? '99+' : notificationCount}
                            </span>
                        ) : null}
                    </button>
                </div>

                {/* Center: Duty Toggle + work-mode (which job types to receive) */}
                <div className="flex flex-col items-center gap-1.5 pointer-events-auto">
                    <button
                        disabled={isTogglingDuty}
                        onClick={handleDutyToggle}
                        className={`relative flex h-10 w-28 items-center rounded-full p-1 transition-all duration-500 shadow-lg ${isOnline ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-slate-200'
                            }`}
                    >
                        <motion.div
                            animate={{ x: isOnline ? 72 : 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            className="absolute left-1 h-8 w-8 rounded-full bg-white shadow-sm flex items-center justify-center"
                        >
                            <Power size={14} className={isOnline ? 'text-emerald-500' : 'text-slate-400'} strokeWidth={3} />
                        </motion.div>
                        <div className="flex w-full items-center justify-center text-[9px] font-black uppercase tracking-widest pl-2">
                            <span className={`transition-opacity duration-300 ${isOnline ? 'text-white mr-6' : 'text-slate-400 ml-6'}`}>
                                {isOnline ? 'Online' : 'Offline'}
                            </span>
                        </div>
                    </button>

                    {/* Hidden unless the driver holds BOTH taxi + delivery capability */}
                    <WorkModeToggle
                        workMode={workMode}
                        serviceCapabilities={serviceCapabilities}
                        onChange={setWorkMode}
                        disabled={isTogglingDuty}
                    />
                </div>

                {/* Right Side: Wallet */}
                <div className="flex justify-end pointer-events-auto">
                    <div
                        onClick={() => navigate('/taxi/driver/wallet')}
                        className="flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-white shadow-xl shadow-black/10 active:scale-95 transition-all cursor-pointer border border-white/10"
                    >
                        <IndianRupee size={12} className="text-emerald-400" strokeWidth={3} />
                        <span className="text-[13px] font-black tracking-tight">
                            {Number(walletSummary.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                    </div>
                </div>
            </div>

            {/* --- MAP BACKGROUND --- */}
            <div className="absolute inset-0 z-0 w-full h-full">
                {HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                    <GoogleMap
                        mapContainerStyle={containerStyle}
                        center={driverPosition}
                        zoom={15}
                        onLoad={onLoad}
                        onUnmount={onUnmount}
                        options={mapOptions}
                        onClick={(e) => {
                            if (!e.latLng) return;
                            const newCoords = [e.latLng.lng(), e.latLng.lat()];
                            driverCoordsRef.current = newCoords;
                            setDriverCoords(newCoords);
                            persistStoredDriverInfo({
                                location: { coordinates: newCoords },
                                coordinates: newCoords
                            });
                            if (isOnline) {
                                socketService.emit('locationUpdate', { coordinates: newCoords });
                            }
                            setStatusMessage('Location updated manually.');
                        }}
                    >
                        <Marker
                            position={driverPosition}
                            icon={{
                                url: mapVehicleIcon,
                                scaledSize: new window.google.maps.Size(40, 40),
                                anchor: new window.google.maps.Point(20, 20)
                            }}
                        />
                    </GoogleMap>
                ) : (
                    <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                        <div className="text-center px-10">
                            <div className="w-16 h-16 bg-slate-300 rounded-full animate-pulse mx-auto mb-4" />
                            <p className="text-slate-500 font-medium text-sm">Map unavailable. Configure Google Maps key.</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="absolute right-5 top-1/2 z-30 -translate-y-1/2">
                <button
                    type="button"
                    onClick={recenterMap}
                    className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-slate-100 bg-white/95 text-slate-900 shadow-[0_12px_30px_rgba(15,23,42,0.16)] transition-transform active:scale-90"
                    aria-label="Recenter map"
                >
                    <Target size={20} strokeWidth={2.4} />
                </button>
            </div>

            {/* --- BOTTOM FLOATING UI --- */}
            <div className="fixed bottom-20 left-0 right-0 p-6 pb-4 z-[60] flex flex-col max-w-md mx-auto">
                <AnimatePresence>
                    {statusMessage ? (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.96 }}
                            className="mb-4 self-center max-w-[280px] rounded-2xl bg-slate-900/92 px-4 py-3 text-center shadow-2xl backdrop-blur"
                        >
                            <p className="text-[12px] font-bold leading-relaxed text-white">{statusMessage}</p>
                        </motion.div>
                    ) : null}
                </AnimatePresence>

                {/* Today's Stats Summary - Visible in both offline and online modes */}
                <AnimatePresence>
                    <motion.div
                        layout
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 40 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="w-full overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1)]"
                    >
                        <button
                            type="button"
                            onClick={() => setIsTodaySummaryExpanded((current) => !current)}
                            className="flex w-full items-center justify-between px-5 py-4 text-left"
                            aria-expanded={isTodaySummaryExpanded}
                            aria-label={isTodaySummaryExpanded ? 'Collapse today summary' : 'Expand today summary'}
                        >
                            <div className="flex items-center gap-3">
                                <h4 className="text-[13px] font-black uppercase tracking-widest text-slate-400">Today&apos;s Summary</h4>
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            </div>
                            <motion.div
                                animate={{ rotate: isTodaySummaryExpanded ? 90 : -90 }}
                                transition={{ duration: 0.2 }}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-500"
                            >
                                <ChevronRight size={16} strokeWidth={2.8} />
                            </motion.div>
                        </button>

                        <AnimatePresence initial={false}>
                            {isTodaySummaryExpanded ? (
                                <motion.div
                                    key="today-summary-content"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeInOut' }}
                                    className="overflow-hidden px-5 pb-5"
                                >
                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="flex flex-col items-center">
                                            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                                                <IndianRupee size={18} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[14px] font-black text-slate-900">{formatSummaryMoney(todaySummary.earnings)}</span>
                                            <span className="text-[9px] font-bold uppercase tracking-tight text-slate-400">Earnings</span>
                                        </div>

                                        <div className="flex flex-col items-center">
                                            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                                                <Clock size={18} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[14px] font-black text-slate-900">{`${dutyHours}h ${dutyMins}m`}</span>
                                            <span className="text-[9px] font-bold uppercase tracking-tight text-slate-400">Active</span>
                                        </div>

                                        <div className="flex flex-col items-center">
                                            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-orange/5 text-accent-orange">
                                                <Navigation size={18} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[14px] font-black text-slate-900">{formatSummaryDistance(todaySummary.distanceMeters)}</span>
                                            <span className="text-[9px] font-bold uppercase tracking-tight text-slate-400">Distance</span>
                                        </div>

                                        <div className="flex flex-col items-center">
                                            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-50 text-purple-600">
                                                <BarChart2 size={18} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[14px] font-black text-slate-900">{todaySummary.rides}</span>
                                            <span className="text-[9px] font-bold uppercase tracking-tight text-slate-400">Rides</span>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Status Based Background Overlay */}
            <AnimatePresence>
                {!isOnline && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-slate-900/10 via-transparent to-transparent pointer-events-none z-10"
                    />
                )}
            </AnimatePresence>

            <DriverBottomNav />
        </div>
    );
};

export default DriverHome;
