import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MapPin, FileText } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import api from './shared/api/axiosInstance';
import { socketService } from './shared/api/socket';
import { SettingsProvider } from './shared/context/SettingsContext';
import AppAutoUpdater from './modules/shared/components/AppAutoUpdater';
import { addRealtimeNotification } from './modules/user/utils/realtimeNotificationStore';
import { clearLocalUserSession, getLocalUserToken } from './modules/user/services/authService';
import { clearCurrentRide } from './modules/user/services/currentRideService';
import RentalLocationTracker from './modules/user/components/RentalLocationTracker';
import userBusService from './modules/user/services/busService';
import { userService } from './modules/user/services/userService';
import { syncUpcomingRideReminders } from './modules/user/utils/upcomingRideReminderService';
import { getAuthenticatedDriverRole, getLocalDriverToken } from './modules/driver/services/registrationService';
import { installBrowserFcmRegistration } from './shared/push/browserFcmRegistration';
import { installNativeFcmBridge } from './shared/push/nativeFcmBridge';
import './App.css';


// Lazy loading pages for performance
import UserHome from './modules/user/pages/Home';
const Login = lazy(() => import('./modules/user/pages/auth/Login'));
const VerifyOTP = lazy(() => import('./modules/user/pages/auth/VerifyOTP'));
const Signup = lazy(() => import('./modules/user/pages/auth/Signup'));

// Ride Module Pages
const SelectLocation = lazy(() => import('./modules/user/pages/ride/SelectLocation'));
const SelectVehicle = lazy(() => import('./modules/user/pages/ride/SelectVehicle'));
const SearchingDriver = lazy(() => import('./modules/user/pages/ride/SearchingDriver'));
const RideTracking = lazy(() => import('./modules/user/pages/ride/RideTracking'));
const RideComplete = lazy(() => import('./modules/user/pages/ride/RideComplete'));
const Chat = lazy(() => import('./modules/user/pages/ride/Chat'));
const Support = lazy(() => import('./modules/user/pages/ride/Support'));
const RideDetail = lazy(() => import('./modules/user/pages/ride/RideDetail'));

// Parcel Module Pages
const ParcelType = lazy(() => import('./modules/user/pages/parcel/ParcelType'));
const SenderReceiverDetails = lazy(() => import('./modules/user/pages/parcel/SenderReceiverDetails'));

// Profile & History
const Activity = lazy(() => import('./modules/user/pages/Activity'));
const Profile = lazy(() => import('./modules/user/pages/Profile'));
const Wallet = lazy(() => import('./modules/user/pages/Wallet'));

// Coming Soon placeholder (for /tours and any unbuilt routes)
const ComingSoon = lazy(() => import('./modules/shared/pages/ComingSoon'));
const LegalPage = lazy(() => import('./modules/shared/pages/LegalPage'));
// Public Pages
const AboutPage = lazy(() => import('./modules/shared/pages/AboutPage'));
const CareersPage = lazy(() => import('./modules/shared/pages/CareersPage'));
const NewsroomPage = lazy(() => import('./modules/shared/pages/NewsroomPage'));
const ContactPage = lazy(() => import('./modules/shared/pages/ContactPage'));
const FaqPage = lazy(() => import('./modules/shared/pages/FaqPage'));
const ServicesPage = lazy(() => import('./modules/shared/pages/ServicesPage'));
const BlogPage = lazy(() => import('./modules/shared/pages/BlogPage'));
const LinksPage = lazy(() => import('./modules/shared/pages/LinksPage'));

// Phase 1 — Parcel flow completions
const ParcelSearchingDriver = lazy(() => import('./modules/user/pages/parcel/ParcelSearchingDriver'));
const ParcelTracking = lazy(() => import('./modules/user/pages/parcel/ParcelTracking'));

// Phase 2 — Core utility pages
const UserNotifications = lazy(() => import('./modules/user/pages/Notifications'));
const PromoCodes = lazy(() => import('./modules/user/pages/PromoCodes'));
const UserReferral = lazy(() => import('./modules/user/pages/Referral'));

// Phase 3 — Safety & Support
const SOSContacts = lazy(() => import('./modules/user/pages/safety/SOSContacts'));
const SupportTickets = lazy(() => import('./modules/user/pages/support/SupportTickets'));
const SupportTicketDetail = lazy(() => import('./modules/user/pages/support/SupportTicketDetail'));
const DeleteAccount = lazy(() => import('./modules/user/pages/profile/DeleteAccount'));

const UserSafetyCenter = lazy(() => import('./modules/user/pages/safety/SafetyCenter'));
const UserTrustedContacts = lazy(() => import('./modules/user/pages/safety/TrustedContacts'));
const UserReportDriver = lazy(() => import('./modules/user/pages/safety/ReportDriver'));
const UserTripSharing = lazy(() => import('./modules/user/pages/safety/TripSharing'));
const UserSafetyTips = lazy(() => import('./modules/user/pages/safety/SafetyTips'));

// Phase 4 — Cab/Intercity/Bus flows
const CabHome = lazy(() => import('./modules/user/pages/cab/CabHome'));
const SharedTaxi = lazy(() => import('./modules/user/pages/cab/SharedTaxi'));
const SharedTaxiSeats = lazy(() => import('./modules/user/pages/cab/SharedTaxiSeats'));
const SharedTaxiConfirm = lazy(() => import('./modules/user/pages/cab/SharedTaxiConfirm'));
const AirportCab = lazy(() => import('./modules/user/pages/cab/AirportCab'));
const AirportCabConfirm = lazy(() => import('./modules/user/pages/cab/AirportCabConfirm'));
const SpiritualTrip = lazy(() => import('./modules/user/pages/cab/SpiritualTrip'));
const SpiritualTripVehicle = lazy(() => import('./modules/user/pages/cab/SpiritualTripVehicle'));
const SpiritualTripConfirm = lazy(() => import('./modules/user/pages/cab/SpiritualTripConfirm'));

const IntercityVehicle = lazy(() => import('./modules/user/pages/intercity/IntercityVehicle'));
const IntercityDetails = lazy(() => import('./modules/user/pages/intercity/IntercityDetails'));
const IntercityConfirm = lazy(() => import('./modules/user/pages/intercity/IntercityConfirm'));

const BusHome = lazy(() => import('./modules/user/pages/bus/BusHome'));
const BusList = lazy(() => import('./modules/user/pages/bus/BusList'));
const BusSeats = lazy(() => import('./modules/user/pages/bus/BusSeats'));
const BusPreview = lazy(() => import('./modules/user/pages/bus/BusPreview'));
const BusDetails = lazy(() => import('./modules/user/pages/bus/BusDetails'));
const BusConfirm = lazy(() => import('./modules/user/pages/bus/BusConfirm'));

// Phase 5 — Onboarding
const Onboarding = lazy(() => import('./modules/user/pages/auth/Onboarding'));

// New Feature Pages
// const BikeRentalHome = lazy(() => import('./modules/user/pages/rental/BikeRentalHome'));
// const RentalVehicleDetail = lazy(() => import('./modules/user/pages/rental/RentalVehicleDetail'));
// const RentalSchedule = lazy(() => import('./modules/user/pages/rental/RentalSchedule'));
// const RentalKYC = lazy(() => import('./modules/user/pages/rental/RentalKYC'));
// const RentalDeposit = lazy(() => import('./modules/user/pages/rental/RentalDeposit'));
// const RentalConfirmed = lazy(() => import('./modules/user/pages/rental/RentalConfirmed'));
const IntercityHome = lazy(() => import('./modules/user/pages/intercity/IntercityHome'));
const CabSharing = lazy(() => import('./modules/user/pages/cabsharing/CabSharing'));

// Car Pooling flow
const UserPoolingHome = lazy(() => import('./modules/user/pages/pooling/PoolingHome'));
const UserPoolingList = lazy(() => import('./modules/user/pages/pooling/PoolingList'));
const UserPoolingSeats = lazy(() => import('./modules/user/pages/pooling/PoolingSeats'));
const UserPoolingConfirm = lazy(() => import('./modules/user/pages/pooling/PoolingConfirm'));

// Profile Settings Sub-pages
const ProfileSettings = lazy(() => import('./modules/user/pages/profile/ProfileSettings'));
const PaymentSettings = lazy(() => import('./modules/user/pages/profile/PaymentSettings'));
const AddressSettings = lazy(() => import('./modules/user/pages/profile/AddressSettings'));
const BusBookings = lazy(() => import('./modules/user/pages/profile/BusBookings'));
const BusBookingDetail = lazy(() => import('./modules/user/pages/profile/BusBookingDetail'));
const UserSubscriptions = lazy(() => import('./modules/user/pages/profile/Subscriptions'));
// Driver Module - Common
import DriverLayout from './modules/driver/components/DriverLayout';

// Driver Module - Registration
const LanguageSelect = lazy(() => import('./modules/driver/pages/registration/LanguageSelect'));
const DriverWelcome = lazy(() => import('./modules/driver/pages/registration/DriverWelcome'));
const PhoneRegistration = lazy(() => import('./modules/driver/pages/registration/PhoneRegistration'));
const OTPVerification = lazy(() => import('./modules/driver/pages/registration/OTPVerification'));
const RegistrationStatus = lazy(() => import('./modules/driver/pages/registration/RegistrationStatus'));
const StepPersonal = lazy(() => import('./modules/driver/pages/registration/StepPersonal'));
const StepReferral = lazy(() => import('./modules/driver/pages/registration/StepReferral'));
const StepVehicle = lazy(() => import('./modules/driver/pages/registration/StepVehicle'));
const StepDocuments = lazy(() => import('./modules/driver/pages/registration/StepDocuments'));
const ApplicationStatus = lazy(() => import('./modules/driver/pages/registration/ApplicationStatus'));

// Driver Module - Core
const DriverHome = lazy(() => import('./modules/driver/pages/DriverHome'));
const OwnerDashboard = lazy(() => import('./modules/driver/pages/OwnerDashboard'));
const OwnerBusServicePage = lazy(() => import('./modules/driver/pages/OwnerBusServicePage'));
const OwnerBusBookingsPage = lazy(() => import('./modules/driver/pages/OwnerBusBookingsPage'));
const ActiveTrip = lazy(() => import('./modules/driver/pages/ActiveTrip'));
const DriverWallet = lazy(() => import('./modules/driver/pages/DriverWallet'));
const DriverProfile = lazy(() => import('./modules/driver/pages/DriverProfile'));
const ServiceCenterDashboard = lazy(() => import('./modules/driver/pages/ServiceCenterDashboard'));
const ServiceCenterVehicleDetails = lazy(() => import('./modules/driver/pages/ServiceCenterVehicleDetails'));
const RideRequests = lazy(() => import('./modules/driver/pages/RideRequests'));
const DriverIncentives = lazy(() => import('./modules/driver/pages/DriverIncentives'));
const BusDriverHome = lazy(() => import('./modules/driver/pages/BusDriverHome'));

// Driver Module - Settings
const EditProfile = lazy(() => import('./modules/driver/pages/settings/EditProfile'));
const DriverDocuments = lazy(() => import('./modules/driver/pages/settings/DriverDocuments'));
const Notifications = lazy(() => import('./modules/driver/pages/settings/Notifications'));
const PayoutMethods = lazy(() => import('./modules/driver/pages/settings/PayoutMethods'));
const Referral = lazy(() => import('./modules/driver/pages/settings/Referral'));
const DriverDeleteAccount = lazy(() => import('./modules/driver/pages/settings/DeleteAccount'));
const SecuritySOS = lazy(() => import('./modules/driver/pages/settings/SecuritySOS'));
const DriverSupport = lazy(() => import('./modules/driver/pages/settings/Support'));
const DriverHelpSupportOptions = lazy(() => import('./modules/driver/pages/settings/HelpSupportOptions'));
const DriverSupportChat = lazy(() => import('./modules/driver/pages/settings/SupportChat'));
const VehicleFleet = lazy(() => import('./modules/driver/pages/settings/VehicleFleet'));
const OwnerVehicleFleet = lazy(() => import('./modules/driver/pages/settings/OwnerVehicleFleet'));
const AddVehicle = lazy(() => import('./modules/driver/pages/settings/AddVehicle'));
const ManageDrivers = lazy(() => import('./modules/driver/pages/settings/ManageDrivers'));
const AddDriver = lazy(() => import('./modules/driver/pages/settings/AddDriver'));

// Admin Module Pages
const AdminLayout = lazy(() => import('./modules/admin/components/AdminLayout'));
const AdminLogin = lazy(() => import('./modules/admin/pages/auth/AdminLogin'));
const AdminDashboard = lazy(() => import('./modules/admin/pages/dashboard/MainDashboard'));
const AdminEarnings = lazy(() => import('./modules/admin/pages/dashboard/AdminEarnings'));
const AdminChat = lazy(() => import('./modules/admin/pages/operations/Chat'));
const AdminTrips = lazy(() => import('./modules/admin/pages/operations/Trips'));
const AdminDeliveries = lazy(() => import('./modules/admin/pages/operations/Deliveries'));
const AdminOngoing = lazy(() => import('./modules/admin/pages/operations/Ongoing'));
const AdminWalletPayment = lazy(() => import('./modules/admin/pages/wallet/WalletPayment'));
const AdminUserList = lazy(() => import('./modules/admin/pages/users/UserList'));
const AdminUserCreate = lazy(() => import('./modules/admin/pages/users/UserCreate'));
const AdminUserDetails = lazy(() => import('./modules/admin/pages/users/UserDetails'));
const AdminDeleteRequestUsers = lazy(() => import('./modules/admin/pages/users/DeleteRequestUsers'));
const AdminUserBulkUpload = lazy(() => import('./modules/admin/pages/users/UserBulkUpload'));
const AdminUserImportCreate = lazy(() => import('./modules/admin/pages/users/UserImportCreate'));
const AdminUserSubscriptions = lazy(() => import('./modules/admin/pages/users/UserSubscriptions'));
const AdminUserSubscriptionCreate = lazy(() => import('./modules/admin/pages/users/UserSubscriptionCreate'));

// DRIVER MANAGEMENT IMPORTS
const AdminDriverList = lazy(() => import('./modules/admin/pages/drivers/DriverList'));
const AdminDriverDetails = lazy(() => import('./modules/admin/pages/drivers/DriverDetails'));
const AdminPendingDrivers = lazy(() => import('./modules/admin/pages/drivers/PendingDrivers'));
const AdminDriverSubscriptions = lazy(() => import('./modules/admin/pages/drivers/DriverSubscriptions'));
const AdminDriverSubscriptionCreate = lazy(() => import('./modules/admin/pages/drivers/DriverSubscriptionCreate'));
const AdminDriverRatings = lazy(() => import('./modules/admin/pages/drivers/DriverRatings'));
const AdminDriverRatingDetail = lazy(() => import('./modules/admin/pages/drivers/DriverRatingDetail'));
const AdminDriverWallet = lazy(() => import('./modules/admin/pages/drivers/DriverWallet'));
const AdminNegativeBalanceDrivers = lazy(() => import('./modules/admin/pages/drivers/NegativeBalanceDrivers'));
const AdminWithdrawalRequestDrivers = lazy(() => import('./modules/admin/pages/drivers/WithdrawalRequestDrivers'));
const AdminWithdrawalRequestDetail = lazy(() => import('./modules/admin/pages/drivers/WithdrawalRequestDetail'));
const AdminDriverDeleteRequests = lazy(() => import('./modules/admin/pages/drivers/DriverDeleteRequests'));
const AdminGlobalDocuments = lazy(() => import('./modules/admin/pages/drivers/GlobalDocuments'));
const AdminDriverDocumentForm = lazy(() => import('./modules/admin/pages/drivers/DriverDocumentForm'));
const AdminDriverBulkUpload = lazy(() => import('./modules/admin/pages/drivers/DriverBulkUpload'));
const AdminDriverImportCreate = lazy(() => import('./modules/admin/pages/drivers/DriverImportCreate'));
const AdminDriverAudit = lazy(() => import('./modules/admin/pages/drivers/DriverAudit'));
const AdminPaymentMethods = lazy(() => import('./modules/admin/pages/drivers/PaymentMethods'));
const AdminDriverCreate = lazy(() => import('./modules/admin/pages/drivers/CreateDriver'));
const AdminDriverEdit = lazy(() => import('./modules/admin/pages/drivers/EditDriver'));
const AdminReferralDashboard = lazy(() => import('./modules/admin/pages/referrals/ReferralDashboard'));
const AdminUserReferralSettings = lazy(() => import('./modules/admin/pages/referrals/UserReferralSettings'));
const AdminDriverReferralSettings = lazy(() => import('./modules/admin/pages/referrals/DriverReferralSettings'));
const AdminReferralTranslation = lazy(() => import('./modules/admin/pages/referrals/ReferralTranslation'));

const AdminPromoCodes = lazy(() => import('./modules/admin/pages/promotions/PromoCodes'));
const AdminSendNotification = lazy(() => import('./modules/admin/pages/promotions/SendNotification'));
const AdminBannerImage = lazy(() => import('./modules/admin/pages/promotions/BannerImage'));

// Price Management
const AdminServiceLocation = lazy(() => import('./modules/admin/pages/price-management/ServiceLocation'));
const AdminServiceStores = lazy(() => import('./modules/admin/pages/price-management/ServiceStores'));
const AdminZoneManagement = lazy(() => import('./modules/admin/pages/price-management/ZoneManagement'));
const AdminAirportManagement = lazy(() => import('./modules/admin/pages/price-management/Airport'));
const AdminSetPrices = lazy(() => import('./modules/admin/pages/price-management/SetPrices'));
const AdminSetPackagePrices = lazy(() => import('./modules/admin/pages/price-management/SetPackagePrices'));
const AdminCreatePackagePrice = lazy(() => import('./modules/admin/pages/price-management/CreatePackagePrice'));
const AdminDriverIncentive = lazy(() => import('./modules/admin/pages/price-management/DriverIncentive'));
const AdminSurgePricing = lazy(() => import('./modules/admin/pages/price-management/SurgePricing'));
const AdminVehicleType = lazy(() => import('./modules/admin/pages/price-management/VehicleType'));
// const AdminRentalVehicleTypes = lazy(() => import('./modules/admin/pages/price-management/RentalVehicleTypes'));
// const AdminRentalTracking = lazy(() => import('./modules/admin/pages/price-management/RentalTracking'));
// const AdminRentalTrackingDetail = lazy(() => import('./modules/admin/pages/price-management/RentalTrackingDetail'));
// const AdminRentalBookingRequests = lazy(() => import('./modules/admin/pages/price-management/RentalBookingRequests'));
// const AdminRentalQuoteRequests = lazy(() => import('./modules/admin/pages/price-management/RentalQuoteRequests'));
// const AdminRentalPackageTypes = lazy(() => import('./modules/admin/pages/price-management/RentalPackageTypes'));
const AdminGoodsTypes = lazy(() => import('./modules/admin/pages/price-management/GoodsTypes'));
const AdminPoolingManager = lazy(() => import('./modules/admin/pages/pooling/PoolingManager'));
const AdminPoolingVehicles = lazy(() => import('./modules/admin/pages/pooling/PoolingVehicles'));
const AdminPoolingVehicleForm = lazy(() => import('./modules/admin/pages/pooling/PoolingVehicleForm'));
const AdminPoolingBookings = lazy(() => import('./modules/admin/pages/pooling/PoolingBookings'));
const AdminPoolingCommissionManager = lazy(() => import('./modules/admin/pages/pooling/PoolingCommissionManager'));
const AdminBusServiceManager = lazy(() => import('./modules/admin/pages/bus-service/BusServiceManager'));
const AdminBusServiceDetails = lazy(() => import('./modules/admin/pages/bus-service/BusServiceDetails'));
const AdminBusBookingManager = lazy(() => import('./modules/admin/pages/bus-service/BusBookingManager'));
const AdminBusCommissionManager = lazy(() => import('./modules/admin/pages/bus-service/BusCommissionManager'));
const AdminPricingPlaceholder = ({ title }) => (
  <div className="flex flex-col items-center justify-center min-h-[500px] text-gray-400 bg-white rounded-[32px] border border-gray-100 shadow-sm p-10">
    <MapPin size={60} strokeWidth={1} className="mb-6 opacity-20" />
    <h2 className="text-xl font-black text-gray-900 uppercase tracking-widest">{title}</h2>
    <p className="mt-2 font-bold italic tracking-tight">Configuration module coming soon</p>
  </div>
);

const AdminOwnerDashboard = lazy(() => import('./modules/admin/pages/owners/OwnerDashboard'));
const AdminManageOwners = lazy(() => import('./modules/admin/pages/owners/ManageOwners'));
const AdminPendingOwners = lazy(() => import('./modules/admin/pages/owners/PendingOwners'));
const AdminOwnerDetails = lazy(() => import('./modules/admin/pages/owners/OwnerDetails'));
const AdminOwnerCreate = lazy(() => import('./modules/admin/pages/owners/OwnerCreate'));
const AdminOwnerPasswordUpdate = lazy(() => import('./modules/admin/pages/owners/OwnerPasswordUpdate'));
const AdminOwnerNeededDocuments = lazy(() => import('./modules/admin/pages/owners/OwnerNeededDocuments'));
const AdminOwnerNeededDocumentsCreate = lazy(() => import('./modules/admin/pages/owners/OwnerNeededDocumentsCreate'));
const AdminManageFleet = lazy(() => import('./modules/admin/pages/owners/ManageFleet'));
const AdminManageFleetCreate = lazy(() => import('./modules/admin/pages/owners/ManageFleetCreate'));
const AdminFleetDrivers = lazy(() => import('./modules/admin/pages/owners/FleetDrivers'));
const AdminFleetDriverCreate = lazy(() => import('./modules/admin/pages/owners/FleetDriverCreate'));
const AdminBlockedFleetDrivers = lazy(() => import('./modules/admin/pages/owners/BlockedFleetDrivers'));
const AdminFleetNeededDocuments = lazy(() => import('./modules/admin/pages/owners/FleetNeededDocuments'));
const AdminFleetNeededDocumentsCreate = lazy(() => import('./modules/admin/pages/owners/FleetNeededDocumentsCreate'));
const AdminWithdrawalRequestOwners = lazy(() => import('./modules/admin/pages/owners/WithdrawalRequestOwners'));
const AdminWithdrawalRequestOwnerDetail = lazy(() => import('./modules/admin/pages/owners/WithdrawalRequestOwnerDetail'));
const AdminDeletedOwners = lazy(() => import('./modules/admin/pages/owners/DeletedOwners'));
const AdminOwnerBookings = lazy(() => import('./modules/admin/pages/owners/OwnerBookings'));

const AdminGeoFencing = lazy(() => import('./modules/admin/pages/geo/GeoFencing'));
const AdminHeatMap = lazy(() => import('./modules/admin/pages/geo/HeatMap'));
const AdminGodsEye = lazy(() => import('./modules/admin/pages/geo/GodsEye'));
const AdminFinance = lazy(() => import('./modules/admin/pages/finance/Finance'));
const AdminFareConfig = lazy(() => import('./modules/admin/pages/finance/FareConfiguration'));
const AdminSafetyCenter = lazy(() => import('./modules/admin/pages/safety/SafetyCenter'));
const AdminSafetySettings = lazy(() => import('./modules/admin/pages/safety/SafetySettings'));
const AdminCMSBuilder = lazy(() => import('./modules/admin/pages/cms/CMSBuilder'));
const AdminHeaderFooter = lazy(() => import('./modules/admin/pages/cms/HeaderFooter'));
const AdminLandingSettings = lazy(() => import('./modules/admin/pages/cms/LandingPageSettings'));
const AdminGlobalSettings = lazy(() => import('./modules/admin/pages/settings/GlobalSettings'));
const AdminGeneralSettings = lazy(() => import('./modules/admin/pages/settings/GeneralSettings'));
const AdminCustomizationSettings = lazy(() => import('./modules/admin/pages/settings/CustomizationSettings'));
const AdminTransportRideSettings = lazy(() => import('./modules/admin/pages/settings/TransportRideSettings'));
const AdminBidRideSettings = lazy(() => import('./modules/admin/pages/settings/BidRideSettings'));
const AdminWalletSettings = lazy(() => import('./modules/admin/pages/settings/WalletSettings'));
const AdminTipSettings = lazy(() => import('./modules/admin/pages/settings/TipSettings'));
const AdminAppModules = lazy(() => import('./modules/admin/pages/settings/AppModules'));
const AdminOnboardingScreens = lazy(() => import('./modules/admin/pages/settings/OnboardingScreens'));
const AdminPaymentGateways = lazy(() => import('./modules/admin/pages/settings/PaymentGateways'));
const AdminSMSGateways = lazy(() => import('./modules/admin/pages/settings/SMSGateways'));
const AdminFirebaseSettings = lazy(() => import('./modules/admin/pages/settings/FirebaseSettings'));
const AdminMapSettings = lazy(() => import('./modules/admin/pages/settings/MapSettings'));
const AdminMailSettings = lazy(() => import('./modules/admin/pages/settings/MailSettings'));
const AdminNotificationChannels = lazy(() => import('./modules/admin/pages/settings/NotificationChannels'));
const AdminDispatcherAddons = lazy(() => import('./modules/admin/pages/settings/DispatcherAddons'));
const AdminLogoSettings = lazy(() => import('./modules/admin/pages/settings/LogoSettings'));
const AdminCountryManagement = lazy(() => import('./modules/admin/pages/masters/CountryManagement'));
const AdminSupportTicketTitle = lazy(() => import('./modules/admin/pages/support/TicketTitle'));
const AdminSupportTickets = lazy(() => import('./modules/admin/pages/support/SupportTickets'));


// Reports Module
const AdminUserReport = lazy(() => import('./modules/admin/pages/reports/UserReport'));
const AdminDriverReport = lazy(() => import('./modules/admin/pages/reports/DriverReport'));
const AdminDriverDutyReport = lazy(() => import('./modules/admin/pages/reports/DriverDutyReport'));
const AdminOwnerReport = lazy(() => import('./modules/admin/pages/reports/OwnerReport'));
const AdminFinanceReport = lazy(() => import('./modules/admin/pages/reports/FinanceReport'));
const AdminFleetFinanceReport = lazy(() => import('./modules/admin/pages/reports/FleetFinanceReport'));

// Masters Management
const AdminLanguages = lazy(() => import('./modules/admin/pages/masters/Languages'));
const AdminPreferences = lazy(() => import('./modules/admin/pages/masters/Preferences'));

// Admin Management
const AdminAdmins = lazy(() => import('./modules/admin/pages/management/Admins'));
const AdminAdminCreate = lazy(() => import('./modules/admin/pages/management/AdminCreate'));

const AdminReportPlaceholder = ({ title }) => (
  <div className="flex flex-col items-center justify-center min-h-[500px] text-gray-400 bg-white rounded-[32px] border border-gray-100 shadow-sm p-10 mx-6">
    <FileText size={60} strokeWidth={1} className="mb-6 opacity-20" />
    <h2 className="text-xl font-black text-gray-900 uppercase tracking-widest">{title}</h2>
    <p className="mt-2 font-bold italic tracking-tight text-primary">Report engine initializing...</p>
  </div>
);

const AdminSectionPlaceholder = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const title = location.pathname
    .split('/')
    .filter(Boolean)
    .slice(1)
    .join(' / ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="max-w-xl w-full bg-white rounded-[32px] border border-gray-100 shadow-sm p-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-5">
          <FileText size={28} />
        </div>
        <h2 className="text-2xl font-black text-gray-950 uppercase tracking-tight">{title || 'Admin Section'}</h2>
        <p className="mt-3 text-sm font-medium text-gray-500 leading-6">
          This admin section is not wired to the user app. It stays inside the admin shell so navigation remains safe.
        </p>
        <button
          type="button"
          onClick={() => navigate('/admin/dashboard')}
          className="mt-8 inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[#2563EB] text-white text-[12px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/20"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

// A wrapper to handle conditional layouts (Mobile for User/Driver, Full for Admin)
const MainLayout = ({ children }) => {
  const location = useLocation();
  const staticPages = ['/taxi', '/taxi/about', '/taxi/contact', '/taxi/faq', '/taxi/services', '/taxi/privacy', '/taxi/terms', '/taxi/refund', '/taxi/cancellation', '/taxi/blog', '/taxi/links', '/taxi/careers', '/taxi/newsroom'];
  const isStaticPath = staticPages.includes(location.pathname);
  const isAdminPath =
    location.pathname.startsWith('/taxi/admin') ||
    location.pathname.startsWith('/taxi/user-import') ||
    location.pathname.startsWith('/taxi/driver-import');

  if (isAdminPath) {
    return <div className="redigo-admin-root h-screen bg-gray-50 overflow-hidden">{children}</div>;
  }

  if (isStaticPath) {
    return (
      <div className="redigo-landing-root min-h-screen bg-white">
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="redigo-app min-h-screen bg-gray-50/50">
      <main className="max-w-lg mx-auto shadow-2xl bg-white min-h-screen relative overflow-x-hidden">
        {children}
      </main>
    </div>
  );
};

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
};

const clearUserSession = () => {
  clearCurrentRide();
  clearLocalUserSession();
};

const UserProtectedRoute = () => {
  const location = useLocation();

  if (!getLocalUserToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};

const UserHomeRoute = ({ taxiPrefixed = true }) => (
  getLocalUserToken()
    ? <UserHome />
    : <Navigate to="/login" state={{ from: { pathname: '/taxi/user' } }} replace />
);

const UserAccountInvalidationListener = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const isUserRoute =
      !location.pathname.startsWith('/admin') &&
      !location.pathname.startsWith('/user-import') &&
      !location.pathname.startsWith('/driver-import') &&
      !location.pathname.startsWith('/owner') &&
      !location.pathname.startsWith('/taxi/driver');

    if (!isUserRoute) {
      return undefined;
    }

    const handleLogout = () => {
      clearUserSession();
      socketService.disconnect();
      navigate('/taxi/user/login', { replace: true });
    };

    const handleAdminChatMessage = (payload = {}) => {
      const senderRole = String(payload.senderRole || payload.sender?.role || '').toLowerCase();
      const receiverRole = String(payload.receiverRole || payload.receiver?.role || '').toLowerCase();
      const messageBody = String(payload.message || payload.body || '').trim();

      if (senderRole !== 'admin' || !messageBody) {
        return;
      }

      if (receiverRole && receiverRole !== 'user') {
        return;
      }

      const notificationWasAdded = addRealtimeNotification({
        id: `support-chat:${payload.id || payload._id || `${Date.now()}-${messageBody}`}`,
        title: 'Support message',
        body: messageBody,
        sentAt: payload.createdAt || new Date().toISOString(),
        type: 'support',
        source: 'support-chat',
      });

      if (!notificationWasAdded) {
        return;
      }

      toast(messageBody, {
        duration: 4500,
        className: 'font-bold text-[13px] rounded-2xl shadow-xl border border-sky-50 bg-white',
      });
    };

    const socket = socketService.connect({ role: 'user' });
    socketService.on('account:deleted', handleLogout);
    socketService.on('chat:message', handleAdminChatMessage);

    const handleAuthStale = (event) => {
      const staleToken = event.detail?.token || '';
      const currentUserToken = localStorage.getItem('userToken') || localStorage.getItem('token') || '';
      const currentAdminToken = localStorage.getItem('adminToken') || '';

      if (event.detail?.role === 'user' && (!staleToken || staleToken === currentUserToken)) {
        toast.error('Your session has expired. Please login again.', {
          id: 'auth-session-expired',
          duration: 4000
        });
        handleLogout();
        return;
      }

      if (event.detail?.role === 'admin' && (!staleToken || staleToken === currentAdminToken)) {
        toast.error('Admin session expired. Please login again.', {
          id: 'admin-session-expired',
          duration: 4000
        });
        socketService.disconnect();
        navigate('/admin/login');
      }
    };

    window.addEventListener('app:auth-stale', handleAuthStale);

    return () => {
      socketService.off('account:deleted', handleLogout);
      socketService.off('chat:message', handleAdminChatMessage);
      window.removeEventListener('app:auth-stale', handleAuthStale);

      if (socket) {
        socketService.disconnect();
      }
    };
  }, [location.pathname, navigate]);

  return null;
};

const getResponsePayload = (response) => response?.data?.data || response?.data || response || {};

const UserUpcomingRideReminderBootstrap = () => {
  const location = useLocation();

  useEffect(() => {
    const isUserRoute =
      location.pathname.startsWith('/taxi/user') ||
      location.pathname === '/user' ||
      location.pathname.startsWith('/ride') ||
      location.pathname.startsWith('/pooling') ||
      location.pathname.startsWith('/bus');

    if (!isUserRoute || !getLocalUserToken()) {
      return undefined;
    }

    let cancelled = false;

    const syncReminders = async () => {
      try {
        const [busResult, poolingResult, scheduledRideResult] = await Promise.all([
          userBusService.getMyBookings({ page: 1, limit: 20, tripState: 'upcoming' }),
          userService.getMyPoolingBookings(),
          api.get('/rides', {
            params: {
              page: 1,
              limit: 20,
              category: 'scheduled',
            },
          }),
        ]);

        if (cancelled) {
          return;
        }

        const busPayload = getResponsePayload(busResult);
        const poolingPayload = getResponsePayload(poolingResult);
        const scheduledRidePayload = getResponsePayload(scheduledRideResult);

        const rawPoolingBookings = Array.isArray(poolingPayload)
          ? poolingPayload
          : Array.isArray(poolingPayload?.results)
            ? poolingPayload.results
            : [];
        const routeIds = [...new Set(rawPoolingBookings.map((booking) => String(booking?.route?._id || '')).filter(Boolean))];
        const routeDetailsEntries = await Promise.all(
          routeIds.map(async (routeId) => {
            try {
              const routeResponse = await userService.getPoolingRouteDetails(routeId);
              return [routeId, getResponsePayload(routeResponse)];
            } catch {
              return [routeId, null];
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const routeDetailsMap = new Map(routeDetailsEntries);
        const poolingBookings = rawPoolingBookings.map((booking) => {
          const routeId = String(booking?.route?._id || '');
          const routeDetails = routeDetailsMap.get(routeId);

          return routeDetails
            ? {
              ...booking,
              route: {
                ...(booking.route || {}),
                ...routeDetails,
              },
            }
            : booking;
        });

        syncUpcomingRideReminders({
          busBookings: Array.isArray(busPayload?.results) ? busPayload.results : [],
          poolingBookings,
          scheduledRides: Array.isArray(scheduledRidePayload?.results) ? scheduledRidePayload.results : [],
        });
      } catch {
        // Reminder sync is non-blocking.
      }
    };

    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        syncReminders();
      }
    };

    syncReminders();
    const intervalId = window.setInterval(syncReminders, 10 * 60 * 1000);
    window.addEventListener('focus', syncReminders);
    document.addEventListener('visibilitychange', handleVisibilitySync);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncReminders);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
    };
  }, [location.pathname]);

  return null;
};

const DriverEntryRedirect = () => {
  const token = getLocalDriverToken();
  const role = String(getAuthenticatedDriverRole() || 'driver').toLowerCase();

  if (!token) {
    return <Navigate to="/taxi/driver/login" replace />;
  }

  return (
    <Navigate
      to={
        role === 'owner'
          ? '/taxi/owner/dashboard'
          : role === 'service_center'
            ? '/taxi/driver/service-center'
            : role === 'service_center_staff'
              ? '/taxi/driver/service-center'
              : role === 'bus_driver'
                ? '/taxi/driver/bus-home'
                : '/taxi/driver/home'
      }
      replace
    />
  );
};

function TaxiApp() {
  useEffect(() => {
    installNativeFcmBridge();
    installBrowserFcmRegistration();
  }, []);

  return (
    <>
      <RentalLocationTracker />
      <AppAutoUpdater />
      <ScrollToTop />
      <UserAccountInvalidationListener />
      <UserUpcomingRideReminderBootstrap />
      <MainLayout>
        <Suspense
          fallback={
            <div className="flex items-center justify-center min-h-screen bg-white">
              <span className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></span>
            </div>
          }>
          <Toaster position="top-right" />
          <Routes>
            {/* Static / Public routes */}
            <Route index element={<Navigate to="/" replace />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="careers" element={<CareersPage />} />
            <Route path="newsroom" element={<NewsroomPage />} />
            <Route path="contact" element={<ContactPage />} />
            <Route path="faq" element={<FaqPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="blog" element={<BlogPage />} />
            <Route path="links" element={<LinksPage />} />
            <Route path="terms" element={<LegalPage />} />
            <Route path="terms-and-conditions" element={<LegalPage />} />
            <Route path="privacy" element={<LegalPage />} />
            <Route path="privacy-policy" element={<LegalPage />} />
            <Route path="refund" element={<LegalPage />} />
            <Route path="cancellation" element={<LegalPage />} />
            <Route path="login" element={<Navigate to="/login" replace />} />
            <Route path="onboarding" element={<Navigate to="/login" replace />} />
            <Route path="verify-otp" element={<Navigate to="/login" replace />} />
            <Route path="signup" element={<Signup />} />

            <Route element={<UserProtectedRoute />}>
              <Route
                path="ride/select-location"
                element={<SelectLocation />}
              />
              <Route path="ride/select-vehicle" element={<SelectVehicle />} />
              <Route path="ride/searching" element={<SearchingDriver />} />
              <Route path="ride/tracking" element={<RideTracking />} />
              <Route path="ride/complete" element={<RideComplete />} />
              <Route path="ride/chat" element={<Chat />} />
              <Route path="support" element={<Support />} />
              <Route path="ride/detail/:id" element={<RideDetail />} />

              <Route path="parcel/type" element={<ParcelType />} />
              <Route path="parcel/details" element={<SenderReceiverDetails />} />
              <Route
                path="parcel/contacts"
                element={<SenderReceiverDetails />}
              />
              <Route
                path="parcel/searching"
                element={<ParcelSearchingDriver />}
              />
              <Route path="parcel/tracking" element={<ParcelTracking />} />
              <Route path="parcel/detail/:id" element={<RideDetail />} />

              {/* New Service Routes — Real pages replacing ComingSoon */}
              {/* <Route path="rental" element={<BikeRentalHome />} />
              <Route path="rental/vehicle" element={<RentalVehicleDetail />} />
              <Route path="rental/schedule" element={<RentalSchedule />} />
              <Route path="rental/kyc" element={<RentalKYC />} />
              <Route path="rental/deposit" element={<RentalDeposit />} />
              <Route path="rental/confirmed" element={<RentalConfirmed />} /> */}
              <Route path="intercity" element={<IntercityHome />} />
              <Route path="intercity/vehicle" element={<IntercityVehicle />} />
              <Route path="intercity/details" element={<IntercityDetails />} />
              <Route path="intercity/confirm" element={<IntercityConfirm />} />
              <Route path="cab-sharing" element={<CabSharing />} />
              <Route path="cab" element={<CabHome />} />
              <Route path="cab/shared" element={<SharedTaxi />} />
              <Route path="cab/shared/seats" element={<SharedTaxiSeats />} />
              <Route
                path="cab/shared/confirm"
                element={<SharedTaxiConfirm />}
              />
              <Route path="cab/airport" element={<AirportCab />} />
              <Route
                path="cab/airport-confirm"
                element={<AirportCabConfirm />}
              />
              <Route path="cab/spiritual" element={<SpiritualTrip />} />
              <Route
                path="cab/spiritual-vehicle"
                element={<SpiritualTripVehicle />}
              />
              <Route
                path="cab/spiritual-confirm"
                element={<SpiritualTripConfirm />}
              />
              <Route path="bus" element={<BusHome />} />
              <Route path="bus/list" element={<BusList />} />
              <Route path="bus/seats" element={<BusSeats />} />
              <Route path="bus/details" element={<BusDetails />} />
              <Route path="bus/confirm" element={<BusConfirm />} />
              <Route path="tours" element={<ComingSoon />} />

              <Route path="activity" element={<Activity />} />
              <Route path="profile" element={<Profile />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="notifications" element={<UserNotifications />} />
              <Route path="promo" element={<PromoCodes />} />
              <Route path="referral" element={<UserReferral />} />

              <Route path="profile/settings" element={<ProfileSettings />} />
              <Route path="profile/payments" element={<PaymentSettings />} />
              <Route path="profile/addresses" element={<AddressSettings />} />
              <Route
                path="profile/notifications"
                element={<UserNotifications />}
              />
              <Route
                path="profile/delete-account"
                element={<DeleteAccount />}
              />
              <Route path="safety/sos" element={<SOSContacts />} />
              <Route path="support/tickets" element={<SupportTickets />} />
              <Route
                path="support/ticket/:id"
                element={<SupportTicketDetail />}
              />
            </Route>

            {/* User Module Routes (Taxi-prefixed aliases to match Driver style) */}
            <Route path="user/onboarding" element={<Navigate to="/login" replace />} />
            <Route path="user/login" element={<Navigate to="/login" replace />} />
            <Route path="user/terms" element={<LegalPage />} />
            <Route path="user/privacy" element={<LegalPage />} />
            <Route path="user/refund" element={<LegalPage />} />
            <Route path="user/verify-otp" element={<Navigate to="/login" replace />} />
            <Route path="user/signup" element={<Signup />} />
            <Route path="user" element={<UserHomeRoute taxiPrefixed />} />

            <Route element={<UserProtectedRoute />}>
              <Route
                path="user/ride"
                element={<Navigate to="/taxi/user/ride/select-location" replace />}
              />
              <Route
                path="user/ride/select-location"
                element={<SelectLocation />}
              />
              <Route
                path="user/ride/select-vehicle"
                element={<SelectVehicle />}
              />
              <Route
                path="user/ride/searching"
                element={<SearchingDriver />}
              />
              <Route
                path="user/ride/tracking"
                element={<RideTracking />}
              />
              <Route
                path="user/ride/complete"
                element={<RideComplete />}
              />
              <Route path="user/ride/chat" element={<Chat />} />
              <Route path="user/support" element={<Support />} />
              <Route
                path="user/ride/detail/:id"
                element={<RideDetail />}
              />
              <Route path="user/safety" element={<UserSafetyCenter />} />
              <Route path="user/safety/contacts" element={<UserTrustedContacts />} />
              <Route path="user/safety/report-driver" element={<UserReportDriver />} />
              <Route path="user/safety/trip-sharing" element={<UserTripSharing />} />
              <Route path="user/safety/tips" element={<UserSafetyTips />} />

              <Route path="user/parcel/type" element={<ParcelType />} />
              <Route
                path="user/parcel/details"
                element={<SenderReceiverDetails />}
              />
              <Route
                path="user/parcel/contacts"
                element={<SenderReceiverDetails />}
              />
              <Route
                path="user/parcel/searching"
                element={<ParcelSearchingDriver />}
              />
              <Route
                path="user/parcel/tracking"
                element={<ParcelTracking />}
              />
              <Route
                path="user/parcel/detail/:id"
                element={<RideDetail />}
              />

              <Route path="user/pooling" element={<UserPoolingHome />} />
              <Route path="user/pooling/list" element={<UserPoolingList />} />
              <Route path="user/pooling/seats/:id" element={<UserPoolingSeats />} />
              <Route path="user/pooling/confirm" element={<UserPoolingConfirm />} />
              {/* <Route path="user/rental" element={<BikeRentalHome />} />
              <Route
                path="user/rental/vehicle"
                element={<RentalVehicleDetail />}
              />
              <Route
                path="user/rental/schedule"
                element={<RentalSchedule />}
              />
              <Route path="user/rental/kyc" element={<RentalKYC />} />
              <Route
                path="user/rental/deposit"
                element={<RentalDeposit />}
              />
              <Route
                path="user/rental/confirmed"
                element={<RentalConfirmed />}
              /> */}
              <Route path="user/intercity" element={<IntercityHome />} />
              <Route
                path="user/intercity/vehicle"
                element={<IntercityVehicle />}
              />
              <Route
                path="user/intercity/details"
                element={<IntercityDetails />}
              />
              <Route
                path="user/intercity/confirm"
                element={<IntercityConfirm />}
              />
              <Route path="user/cab-sharing" element={<CabSharing />} />
              <Route path="user/cab" element={<Navigate to="/taxi/user/ride/select-location" replace />} />
              {/* <Route path="user/cab" element={<CabHome />} />
                <Route path="user/cab/shared" element={<SharedTaxi />} />
                <Route
                  path="user/cab/shared/seats"
                  element={<SharedTaxiSeats />}
                />
                <Route
                  path="user/cab/shared/confirm"
                  element={<SharedTaxiConfirm />}
                />
                <Route path="user/cab/airport" element={<AirportCab />} />
                <Route
                  path="user/cab/airport-confirm"
                  element={<AirportCabConfirm />}
                />
                <Route
                  path="user/cab/spiritual"
                  element={<SpiritualTrip />}
                />
                <Route
                  path="user/cab/spiritual-vehicle"
                  element={<SpiritualTripVehicle />}
                />
                <Route
                  path="user/cab/spiritual-confirm"
                  element={<SpiritualTripConfirm />}
                /> */}
              <Route path="user/bus" element={<BusHome />} />
              <Route path="user/bus/list" element={<BusList />} />
              <Route path="user/bus/seats" element={<BusSeats />} />
              <Route path="user/bus/details" element={<BusPreview />} />
              <Route path="user/bus/checkout" element={<BusDetails />} />
              <Route path="user/bus/confirm" element={<BusConfirm />} />
              <Route path="user/tours" element={<ComingSoon />} />

              <Route path="user/activity" element={<Activity />} />
              <Route path="user/profile" element={<Profile />} />
              <Route path="user/wallet" element={<Wallet />} />
              <Route
                path="user/notifications"
                element={<UserNotifications />}
              />
              <Route path="user/promo" element={<PromoCodes />} />
              <Route path="user/referral" element={<UserReferral />} />

              <Route
                path="user/profile/settings"
                element={<ProfileSettings />}
              />
              <Route
                path="user/profile/payments"
                element={<PaymentSettings />}
              />
              <Route
                path="user/profile/addresses"
                element={<AddressSettings />}
              />
              <Route
                path="user/profile/bus-bookings"
                element={<BusBookings />}
              />
              <Route
                path="user/profile/bus-bookings/:id"
                element={<BusBookingDetail />}
              />
              <Route
                path="user/profile/subscriptions"
                element={<UserSubscriptions />}
              />
              <Route
                path="user/profile/notifications"
                element={<UserNotifications />}
              />
              <Route
                path="user/profile/delete-account"
                element={<DeleteAccount />}
              />
              <Route path="user/safety/sos" element={<SOSContacts />} />
              <Route
                path="user/support/tickets"
                element={<SupportTickets />}
              />
              <Route
                path="user/support/ticket/:id"
                element={<SupportTicketDetail />}
              />
            </Route>

            {/* Driver Module Routes - Centralized under DriverLayout for Theme & Styling */}
            <Route path="driver" element={<DriverLayout />}>
              <Route
                index
                element={<DriverEntryRedirect />}
              />
              <Route path="lang-select" element={<LanguageSelect />} />
              <Route path="welcome" element={<DriverWelcome />} />
              <Route path="login" element={<PhoneRegistration />} />
              <Route path="reg-phone" element={<PhoneRegistration />} />
              <Route path="otp-verify" element={<OTPVerification />} />
              <Route path="step-personal" element={<StepPersonal />} />
              <Route path="step-referral" element={<StepReferral />} />
              <Route path="step-vehicle" element={<StepVehicle />} />
              <Route path="step-documents" element={<StepDocuments />} />
              <Route
                path="registration-status"
                element={<RegistrationStatus />}
              />
              <Route path="status" element={<ApplicationStatus />} />

              <Route path="home" element={<DriverHome />} />
              <Route path="bus-home" element={<BusDriverHome />} />
              <Route path="dashboard" element={<DriverHome />} />
              <Route path="active-trip" element={<ActiveTrip />} />
              <Route path="chat" element={<Chat />} />
              <Route path="wallet" element={<DriverWallet />} />
              <Route path="profile" element={<DriverProfile />} />
              <Route path="service-center" element={<ServiceCenterDashboard />} />
              <Route path="service-center/vehicles/new" element={<ServiceCenterVehicleDetails />} />
              <Route path="service-center/vehicles/:vehicleId" element={<ServiceCenterVehicleDetails />} />
              <Route path="history" element={<RideRequests />} />
              <Route path="incentives" element={<DriverIncentives />} />

              <Route path="edit-profile" element={<EditProfile />} />
              <Route path="documents" element={<DriverDocuments />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="payout-methods" element={<PayoutMethods />} />
              <Route path="referral" element={<Referral />} />
              <Route
                path="delete-account"
                element={<DriverDeleteAccount />}
              />
              <Route path="security" element={<SecuritySOS />} />
              <Route path="support" element={<DriverSupport />} />
              <Route
                path="help-support"
                element={<DriverHelpSupportOptions />}
              />
              <Route path="support/chat" element={<DriverSupportChat />} />
              <Route path="support/tickets" element={<SupportTickets />} />
              <Route
                path="support/ticket/:id"
                element={<SupportTicketDetail />}
              />
              <Route path="vehicle-fleet" element={<VehicleFleet />} />
              <Route
                path="vehicle-fleet/edit/:vehicleId"
                element={<VehicleFleet />}
              />
              <Route path="add-vehicle" element={<AddVehicle />} />
              <Route path="manage-drivers" element={<ManageDrivers />} />
              <Route path="add-driver" element={<AddDriver />} />
              <Route path="edit-driver/:driverId" element={<AddDriver />} />
            </Route>

            <Route path="owner" element={<DriverLayout />}>
              <Route index element={<DriverEntryRedirect />} />
              <Route path="login" element={<PhoneRegistration />} />
              <Route path="reg-phone" element={<PhoneRegistration />} />
              <Route path="otp-verify" element={<OTPVerification />} />
              <Route path="lang-select" element={<LanguageSelect />} />
              <Route path="step-personal" element={<StepPersonal />} />
              <Route path="step-referral" element={<StepReferral />} />
              <Route path="step-vehicle" element={<StepVehicle />} />
              <Route path="step-documents" element={<StepDocuments />} />
              <Route path="registration-status" element={<RegistrationStatus />} />
              <Route path="status" element={<ApplicationStatus />} />
              <Route path="home" element={<OwnerDashboard />} />
              <Route path="dashboard" element={<OwnerDashboard />} />
              <Route path="bus-service" element={<OwnerBusServicePage />} />
              <Route path="bus-service/create" element={<OwnerBusServicePage />} />
              <Route path="bus-service/edit/:id" element={<OwnerBusServicePage />} />
              <Route path="bus-service/:id" element={<OwnerBusServicePage />} />
              <Route path="bus-bookings" element={<OwnerBusBookingsPage />} />
              <Route path="profile" element={<DriverProfile />} />
              <Route path="wallet" element={<DriverWallet />} />
              <Route path="history" element={<RideRequests />} />
              <Route path="edit-profile" element={<EditProfile />} />
              <Route path="documents" element={<DriverDocuments />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="payout-methods" element={<PayoutMethods />} />
              <Route path="referral" element={<Referral />} />
              <Route path="delete-account" element={<DriverDeleteAccount />} />
              <Route path="security" element={<SecuritySOS />} />
              <Route path="support" element={<DriverSupport />} />
              <Route path="help-support" element={<DriverHelpSupportOptions />} />
              <Route path="support/chat" element={<DriverSupportChat />} />
              <Route path="support/tickets" element={<SupportTickets />} />
              <Route path="support/ticket/:id" element={<SupportTicketDetail />} />
              <Route path="vehicle-fleet" element={<OwnerVehicleFleet />} />
              <Route
                path="vehicle-fleet/edit/:vehicleId"
                element={<OwnerVehicleFleet />}
              />
              <Route path="add-vehicle" element={<AddVehicle />} />
              <Route path="manage-drivers" element={<ManageDrivers />} />
              <Route path="add-driver" element={<AddDriver />} />
              <Route path="edit-driver/:driverId" element={<AddDriver />} />
            </Route>

            {/* Admin Module Routes */}
            <Route path="admin/login" element={<Navigate to="/admin/login" replace />} />
            <Route path="user-import/create" element={<AdminLayout />}>
              <Route index element={<AdminUserImportCreate />} />
            </Route>
            <Route path="driver-import/create" element={<AdminLayout />}>
              <Route index element={<AdminDriverImportCreate />} />
            </Route>
            <Route path="owner/create" element={<AdminLayout />}>
              <Route index element={<AdminOwnerCreate />} />
            </Route>
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/taxi/admin/dashboard" />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="earnings" element={<AdminEarnings />} />
              <Route path="chat" element={<AdminChat />} />
              <Route path="trips" element={<AdminTrips />} />
              <Route path="deliveries" element={<AdminDeliveries />} />
              <Route path="ongoing" element={<AdminOngoing />} />
              <Route path="bus-service" element={<AdminBusServiceManager basePath="/taxi/admin/bus-service" />} />
              <Route path="bus-service/create" element={<AdminBusServiceManager mode="create" basePath="/taxi/admin/bus-service" />} />
              <Route path="bus-service/edit/:id" element={<AdminBusServiceManager mode="edit" basePath="/taxi/admin/bus-service" />} />
              <Route path="bus-service/commission" element={<AdminBusCommissionManager />} />
              <Route path="bus-service/bookings" element={<AdminBusBookingManager />} />
              <Route path="bus-service/:id" element={<AdminBusServiceDetails />} />
              <Route path="pooling" element={<Navigate to="/taxi/admin/pooling/routes" replace />} />
              <Route path="pooling/routes" element={<AdminPoolingManager />} />
              <Route
                path="pooling/create"
                element={<AdminPoolingManager mode="create" />}
              />
              <Route
                path="pooling/edit/:id"
                element={<AdminPoolingManager mode="edit" />}
              />
              <Route path="pooling/vehicles" element={<AdminPoolingVehicles />} />
              <Route path="pooling/commission" element={<AdminPoolingCommissionManager />} />
              <Route
                path="pooling/vehicles/create"
                element={<AdminPoolingVehicleForm />}
              />
              <Route
                path="pooling/vehicles/edit/:id"
                element={<AdminPoolingVehicleForm />}
              />
              <Route
                path="pooling/vehicles/view/:id"
                element={<AdminPoolingVehicleForm mode="view" />}
              />
              <Route path="pooling/bookings" element={<AdminPoolingBookings />} />
              <Route path="wallet/payment" element={<AdminWalletPayment />} />
              <Route path="users" element={<AdminUserList />} />
              <Route path="users/create" element={<AdminUserCreate />} />
              <Route path="users/subscriptions" element={<AdminUserSubscriptions />} />
              <Route path="users/subscriptions/create" element={<AdminUserSubscriptionCreate />} />
              <Route path="users/:id" element={<AdminUserDetails />} />
              <Route
                path="users/delete-requests"
                element={<AdminDeleteRequestUsers />}
              />
              <Route
                path="users/bulk-upload"
                element={<AdminUserBulkUpload />}
              />
              <Route
                path="user-import/create"
                element={<AdminUserImportCreate />}
              />

              <Route path="drivers" element={<AdminDriverList />} />
              <Route path="drivers/active" element={<AdminDriverList mode="active" />} />
              <Route path="drivers/create" element={<AdminDriverCreate />} />
              <Route path="drivers/edit/:id" element={<AdminDriverEdit />} />
              <Route path="drivers/:id" element={<AdminDriverDetails />} />
              <Route
                path="drivers/pending"
                element={<AdminPendingDrivers />}
              />
              <Route
                path="drivers/subscription"
                element={<AdminDriverSubscriptions />}
              />
              <Route
                path="drivers/subscription/create"
                element={<AdminDriverSubscriptionCreate />}
              />
              <Route
                path="drivers/ratings"
                element={<AdminDriverRatings />}
              />
              <Route
                path="drivers/ratings/:id"
                element={<AdminDriverRatingDetail />}
              />
              <Route path="drivers/wallet" element={<AdminDriverWallet />} />
              <Route
                path="drivers/wallet/negative"
                element={<AdminNegativeBalanceDrivers />}
              />
              <Route
                path="drivers/wallet/withdrawals"
                element={<AdminWithdrawalRequestDrivers />}
              />
              <Route
                path="drivers/wallet/withdrawals/:id"
                element={<AdminWithdrawalRequestDetail />}
              />
              <Route
                path="drivers/delete-requests"
                element={<AdminDriverDeleteRequests />}
              />
              <Route
                path="drivers/documents"
                element={<AdminGlobalDocuments />}
              />
              <Route
                path="drivers/documents/create"
                element={<AdminDriverDocumentForm />}
              />
              <Route
                path="drivers/documents/edit/:id"
                element={<AdminDriverDocumentForm />}
              />
              <Route
                path="drivers/bulk-upload"
                element={<AdminDriverBulkUpload />}
              />
              <Route
                path="driver-import/create"
                element={<AdminDriverImportCreate />}
              />
              <Route
                path="drivers/payment-methods"
                element={<AdminPaymentMethods />}
              />
              <Route
                path="drivers/audit/:id"
                element={<AdminDriverAudit />}
              />
              <Route
                path="referrals/dashboard"
                element={<AdminReferralDashboard />}
              />
              <Route
                path="referrals/user-settings"
                element={<AdminUserReferralSettings />}
              />
              <Route
                path="referrals/driver-settings"
                element={<AdminDriverReferralSettings />}
              />
              <Route
                path="referrals/translation"
                element={<AdminReferralTranslation />}
              />
              {/* Promotions Management */}
              <Route
                path="promotions/promo-codes"
                element={<AdminPromoCodes />}
              />
              <Route
                path="promotions/promo-codes/create"
                element={<AdminPromoCodes />}
              />
              <Route
                path="promotions/promo-codes/edit/:id"
                element={<AdminPromoCodes />}
              />
              <Route
                path="promotions/send-notification"
                element={<AdminSendNotification />}
              />
              <Route
                path="promotions/send-notification/create"
                element={<AdminSendNotification />}
              />
              <Route
                path="promotions/banner-image"
                element={<AdminBannerImage />}
              />
              <Route
                path="promotions/banner-image/create"
                element={<AdminBannerImage />}
              />

              {/* Admin Management */}
              <Route path="management/admins" element={<AdminAdmins />} />
              <Route
                path="management/admins/create"
                element={<AdminAdminCreate />}
              />
              <Route
                path="management/admins/edit/:id"
                element={<AdminAdminCreate />}
              />

              {/* Owner Management */}
              <Route
                path="owners/dashboard"
                element={<AdminOwnerDashboard />}
              />
              <Route path="owners/pending" element={<AdminPendingOwners />} />
              <Route path="owners" element={<AdminManageOwners />} />
              <Route path="owners/create" element={<AdminOwnerCreate />} />
              <Route
                path="owners/:id/password"
                element={<AdminOwnerPasswordUpdate />}
              />
              <Route path="owners/:id" element={<AdminOwnerDetails />} />
              <Route
                path="owners/wallet/withdrawals"
                element={<AdminWithdrawalRequestOwners />}
              />
              <Route
                path="owners/wallet/withdrawals/:id"
                element={<AdminWithdrawalRequestOwnerDetail />}
              />
              <Route path="fleet/drivers" element={<AdminFleetDrivers />} />
              <Route
                path="fleet/drivers/create"
                element={<AdminFleetDriverCreate />}
              />
              <Route
                path="fleet/blocked"
                element={<AdminBlockedFleetDrivers />}
              />
              <Route
                path="fleet/documents"
                element={<AdminFleetNeededDocuments />}
              />
              <Route
                path="fleet/documents/create"
                element={<AdminFleetNeededDocumentsCreate />}
              />
              <Route path="fleet/manage" element={<AdminManageFleet />} />
              <Route
                path="fleet/manage/create"
                element={<AdminManageFleetCreate />}
              />
              <Route
                path="owners/documents"
                element={<AdminOwnerNeededDocuments />}
              />
              <Route
                path="owners/documents/create"
                element={<AdminOwnerNeededDocumentsCreate />}
              />
              <Route path="owners/deleted" element={<AdminDeletedOwners />} />
              <Route
                path="owners/bookings"
                element={<AdminOwnerBookings />}
              />
              <Route
                path="referrals/config"
                element={
                  <div className="flex items-center justify-center min-h-[500px] text-gray-400 font-bold uppercase tracking-widest">
                    Referral Configuration - Under Setup
                  </div>
                }
              />
              <Route
                path="referrals/active"
                element={
                  <div className="flex items-center justify-center min-h-[500px] text-gray-400 font-bold uppercase tracking-widest">
                    Active Referrals Logs - Under Setup
                  </div>
                }
              />
              <Route path="geo/heatmap" element={<AdminHeatMap />} />
              <Route path="geo/gods-eye" element={<AdminGodsEye />} />
              <Route path="geo/peak-zone" element={<AdminGeoFencing />} />
              <Route path="geo/*" element={<AdminGeoFencing />} />
              <Route path="finance" element={<AdminFinance />} />
              {/* Price Management */}
              <Route path="pricing">
                <Route index element={<Navigate to="service-location" />} />
                <Route
                  path="service-location"
                  element={<AdminServiceLocation />}
                />
                <Route
                  path="service-location/add"
                  element={<AdminServiceLocation mode="create" />}
                />
                <Route
                  path="service-location/edit/:id"
                  element={<AdminServiceLocation mode="edit" />}
                />
                <Route
                  path="service-stores"
                  element={<AdminServiceStores />}
                />
                <Route
                  path="service-stores/add"
                  element={<AdminServiceStores mode="create" />}
                />
                <Route
                  path="service-stores/edit/:id"
                  element={<AdminServiceStores mode="edit" />}
                />
                <Route path="app-modules" element={<AdminAppModules />} />
                <Route
                  path="app-modules/create"
                  element={<AdminAppModules mode="create" />}
                />
                <Route
                  path="app-modules/edit/:id"
                  element={<AdminAppModules mode="edit" />}
                />
                <Route path="zone" element={<AdminZoneManagement />} />
                <Route
                  path="zone/create"
                  element={<AdminZoneManagement mode="create" />}
                />
                <Route
                  path="zone/edit/:id"
                  element={<AdminZoneManagement mode="edit" />}
                />
                <Route path="airport" element={<AdminAirportManagement />} />
                <Route
                  path="airport/create"
                  element={<AdminAirportManagement mode="create" />}
                />
                <Route
                  path="airport/edit/:id"
                  element={<AdminAirportManagement mode="edit" />}
                />
                <Route path="vehicle-type" element={<AdminVehicleType />} />
                <Route
                  path="vehicle-type/create"
                  element={<AdminVehicleType mode="create" />}
                />
                <Route
                  path="vehicle-type/edit/:id"
                  element={<AdminVehicleType mode="edit" />}
                />
                {/*<Route
                  path="rental-vehicles"
                  element={<AdminRentalVehicleTypes />}
                />
                <Route
                  path="rental-vehicles/create"
                  element={<AdminRentalVehicleTypes mode="create" />}
                />
                <Route
                  path="rental-vehicles/edit/:id"
                  element={<AdminRentalVehicleTypes mode="edit" />}
                />
                <Route
                  path="rental-vehicles/view/:id"
                  element={<AdminRentalVehicleTypes mode="view" />}
                />
                <Route
                  path="rental-tracking"
                  element={<AdminRentalTracking />}
                />
                <Route
                  path="rental-tracking/:id"
                  element={<AdminRentalTrackingDetail />}
                />
                <Route
                  path="rental-requests"
                  element={<AdminRentalBookingRequests />}
                />
                <Route
                  path="rental-quotes"
                  element={<AdminRentalQuoteRequests />}
                />
                <Route
                  path="rental-packages"
                  element={<AdminRentalPackageTypes />}
                />
                <Route
                  path="rental-packages/create"
                  element={<AdminRentalPackageTypes mode="create" />}
                />
                <Route
                  path="rental-packages/edit/:id"
                  element={<AdminRentalPackageTypes mode="edit" />}
                />*/}
                <Route path="set-price" element={<AdminSetPrices />} />
                <Route
                  path="set-price/create"
                  element={<AdminSetPrices mode="create" />}
                />
                <Route
                  path="set-price/edit/:id"
                  element={<AdminSetPrices mode="edit" />}
                />
                <Route
                  path="set-price/packages/:id"
                  element={<AdminSetPackagePrices />}
                />
                <Route
                  path="set-price/packages/create/:id"
                  element={<AdminCreatePackagePrice mode="create" />}
                />
                <Route
                  path="set-price/packages/edit/:packageId"
                  element={<AdminCreatePackagePrice mode="edit" />}
                />
                <Route
                  path="package-pricing"
                  element={<AdminSetPackagePrices />}
                />
                <Route
                  path="package-pricing/create"
                  element={<AdminCreatePackagePrice mode="create" />}
                />
                <Route
                  path="package-pricing/edit/:packageId"
                  element={<AdminCreatePackagePrice mode="edit" />}
                />
                <Route
                  path="set-price/incentive/:id"
                  element={<AdminDriverIncentive />}
                />
                <Route
                  path="set-price/surge/:id"
                  element={<AdminSurgePricing />}
                />
                <Route path="goods-types" element={<AdminGoodsTypes />} />
                <Route
                  path="goods-types/create"
                  element={<AdminGoodsTypes mode="create" />}
                />
                <Route
                  path="goods-types/edit/:id"
                  element={<AdminGoodsTypes mode="edit" />}
                />
              </Route>
              {/* Safety */}
              <Route path="safety/sos" element={<AdminSafetyCenter />} />
              <Route path="safety/settings" element={<AdminSafetySettings />} />

              <Route path="cms" element={<AdminCMSBuilder />} />
              <Route path="settings/cms/home" element={<AdminLandingSettings defaultTab="general" />} />
              <Route path="settings/cms/about" element={<AdminLandingSettings defaultTab="pages" defaultPage="about_us" />} />
              <Route path="settings/cms/driver" element={<AdminLandingSettings defaultTab="pages" defaultPage="about_us" />} />
              <Route path="settings/cms/user" element={<AdminLandingSettings defaultTab="pages" defaultPage="about_us" />} />
              <Route path="settings/cms/contact" element={<AdminLandingSettings defaultTab="contact" />} />
              <Route path="settings/cms/legal" element={<AdminLandingSettings defaultTab="pages" defaultPage="terms_conditions" />} />
              <Route path="settings/cms/header-footer" element={<AdminLandingSettings defaultTab="general" />} />
              <Route
                path="support/ticket-title"
                element={<AdminSupportTicketTitle />}
              />
              <Route
                path="support/tickets"
                element={<AdminSupportTickets />}
              />
              <Route path="*" element={<AdminSectionPlaceholder />} />

              {/* Report Module Routes */}
              <Route path="reports/user" element={<AdminUserReport />} />
              <Route path="reports/driver" element={<AdminDriverReport />} />
              <Route
                path="reports/driver-duty"
                element={<AdminDriverDutyReport />}
              />
              <Route path="reports/owner" element={<AdminOwnerReport />} />
              <Route
                path="reports/finance"
                element={<AdminFinanceReport />}
              />
              <Route
                path="reports/fleet-finance"
                element={<AdminFleetFinanceReport />}
              />

              {/* Masters Management */}
              <Route path="masters/languages" element={<AdminLanguages />} />
              <Route
                path="masters/countries"
                element={<AdminCountryManagement />}
              />
              <Route
                path="masters/preferences"
                element={<AdminPreferences />}
              />
              <Route
                path="masters/roles"
                element={<Navigate to="/admin/management/admins" replace />}
              />

              <Route
                path="settings/business/general"
                element={<AdminGeneralSettings />}
              />
              <Route
                path="settings/business/customization"
                element={<AdminCustomizationSettings />}
              />
              <Route
                path="settings/business/logos"
                element={<AdminLogoSettings />}
              />
              <Route
                path="settings/business/transport-ride"
                element={<AdminTransportRideSettings />}
              />
              <Route
                path="settings/business/bid-ride"
                element={<AdminBidRideSettings />}
              />

              <Route
                path="settings/app/wallet"
                element={<AdminWalletSettings />}
              />
              <Route path="settings/app/tip" element={<AdminTipSettings />} />
              <Route
                path="settings/app/country"
                element={<AdminCountryManagement />}
              />
              <Route
                path="settings/app/onboard"
                element={<AdminOnboardingScreens />}
              />

              <Route
                path="settings/business/*"
                element={<AdminGeneralSettings />}
              />
              <Route
                path="settings/app/*"
                element={<AdminGeneralSettings />}
              />

              <Route
                path="settings/third-party/payment"
                element={<AdminPaymentGateways />}
              />
              <Route
                path="settings/third-party/sms"
                element={<AdminSMSGateways />}
              />
              <Route
                path="settings/third-party/firebase"
                element={<AdminFirebaseSettings />}
              />
              <Route
                path="settings/third-party/map-apis"
                element={<AdminMapSettings />}
              />
              <Route
                path="settings/third-party/mail"
                element={<AdminMailSettings />}
              />
              <Route
                path="settings/third-party/notification-channel"
                element={<AdminNotificationChannels />}
              />
              <Route
                path="settings/addons/dispatcher"
                element={<AdminDispatcherAddons />}
              />
              <Route
                path="settings/addons/*"
                element={<AdminReportPlaceholder title="Addons Management" />}
              />
              <Route
                path="settings/cms/*"
                element={<AdminReportPlaceholder title="CMS Management" />}
              />
            </Route>

            {/* Removed catch-all to allow parent routing to handle 404s */}
          </Routes>
        </Suspense>
      </MainLayout>
    </>
  );
}

export default TaxiApp;
