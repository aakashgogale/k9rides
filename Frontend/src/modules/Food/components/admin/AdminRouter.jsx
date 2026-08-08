import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import AdminLayout from "./AdminLayout";
import Loader from "@food/components/Loader";

const AdminHome = lazy(() => import("@food/pages/admin/AdminHome"));
const PointOfSale = lazy(() => import("@food/pages/admin/PointOfSale"));
const StatusMonitor = lazy(() => import("@food/pages/admin/dashboard/StatusMonitor"));
const AdminProfile = lazy(() => import("@food/pages/admin/AdminProfile"));
const AdminSettings = lazy(() => import("@food/pages/admin/AdminSettings"));
const NewRefundRequests = lazy(() => import("@food/pages/admin/refunds/NewRefundRequests"));
const FoodApproval = lazy(() => import("@food/pages/admin/restaurant/FoodApproval"));
const OrdersPage = lazy(() => import("@food/pages/admin/orders/OrdersPage"));
const OrderDetectDelivery = lazy(() => import("@food/pages/admin/OrderDetectDelivery"));
const Category = lazy(() => import("@food/pages/admin/categories/Category"));
const FeeSettings = lazy(() => import("@food/pages/admin/fee-settings/FeeSettings"));
const ReferralSettings = lazy(() => import("@food/pages/admin/referral-settings/ReferralSettings"));
// Restaurant Management
const ZoneSetup = lazy(() => import("@food/pages/admin/restaurant/ZoneSetup"));
const AddZone = lazy(() => import("@food/pages/admin/restaurant/AddZone"));
const ViewZone = lazy(() => import("@food/pages/admin/restaurant/ViewZone"));
const AllZonesMap = lazy(() => import("@food/pages/admin/restaurant/AllZonesMap"));
const DeliveryBoyViewMap = lazy(() => import("@food/pages/admin/restaurant/DeliveryBoyViewMap"));
const RestaurantsList = lazy(() => import("@food/pages/admin/restaurant/RestaurantsList"));
const AddRestaurant = lazy(() => import("@food/pages/admin/restaurant/AddRestaurant"));
const JoiningRequest = lazy(() => import("@food/pages/admin/restaurant/JoiningRequest"));
const RestaurantCommission = lazy(() => import("@food/pages/admin/restaurant/RestaurantCommission"));
const RestaurantComplaints = lazy(() => import("@food/pages/admin/restaurant/RestaurantComplaints"));
const RestaurantReviews = lazy(() => import("@food/pages/admin/restaurant/RestaurantReviews"));
const RestaurantsBulkImport = lazy(() => import("@food/pages/admin/restaurant/RestaurantsBulkImport"));
const RestaurantsBulkExport = lazy(() => import("@food/pages/admin/restaurant/RestaurantsBulkExport"));
// Food Management
const FoodsList = lazy(() => import("@food/pages/admin/foods/FoodsList"));
const AddonsList = lazy(() => import("@food/pages/admin/addons/AddonsList"));
// Promotions Management
const BasicCampaign = lazy(() => import("@food/pages/admin/campaigns/BasicCampaign"));
const FoodCampaign = lazy(() => import("@food/pages/admin/campaigns/FoodCampaign"));
const Coupons = lazy(() => import("@food/pages/admin/Coupons"));
const Cashback = lazy(() => import("@food/pages/admin/Cashback"));
const Banners = lazy(() => import("@food/pages/admin/Banners"));
const PromotionalBanner = lazy(() => import("@food/pages/admin/PromotionalBanner"));
const NewAdvertisement = lazy(() => import("@food/pages/admin/advertisement/NewAdvertisement"));
const AdRequests = lazy(() => import("@food/pages/admin/advertisement/AdRequests"));
const AdsList = lazy(() => import("@food/pages/admin/advertisement/AdsList"));

// Help & Support
const Chattings = lazy(() => import("@food/pages/admin/Chattings"));
const ContactMessages = lazy(() => import("@food/pages/admin/ContactMessages"));
const SafetyEmergencyReports = lazy(() => import("@food/pages/admin/SafetyEmergencyReports"));
// Customer Management
const Customers = lazy(() => import("@food/pages/admin/Customers"));
const SupportTickets = lazy(() => import("@food/pages/admin/SupportTickets"));
const AddFund = lazy(() => import("@food/pages/admin/wallet/AddFund"));
const Bonus = lazy(() => import("@food/pages/admin/wallet/Bonus"));
const LoyaltyPointReport = lazy(() => import("@food/pages/admin/loyalty-point/Report"));
const SubscribedMailList = lazy(() => import("@food/pages/admin/SubscribedMailList"));
// Deliveryman Management
const DeliveryCashLimit = lazy(() => import("@food/pages/admin/DeliveryCashLimit"));
const CashLimitSettlement = lazy(() => import("@food/pages/admin/CashLimitSettlement"));
const DeliveryWithdrawal = lazy(() => import("@food/pages/admin/DeliveryWithdrawal"));
const DeliveryBoyWallet = lazy(() => import("@food/pages/admin/DeliveryBoyWallet"));
const DeliveryEmergencyHelp = lazy(() => import("@food/pages/admin/DeliveryEmergencyHelp"));
const DeliverySupportTickets = lazy(() => import("@food/pages/admin/DeliverySupportTickets"));
const JoinRequest = lazy(() => import("@food/pages/admin/delivery-partners/JoinRequest"));
const AddDeliveryman = lazy(() => import("@food/pages/admin/delivery-partners/AddDeliveryman"));
const DeliverymanList = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanList"));
const DeliverymanReviews = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanReviews"));
const DeliverymanBonus = lazy(() => import("@food/pages/admin/delivery-partners/DeliverymanBonus"));
const EarningAddon = lazy(() => import("@food/pages/admin/delivery-partners/EarningAddon"));
const EarningAddonHistory = lazy(() => import("@food/pages/admin/delivery-partners/EarningAddonHistory"));
const DeliveryEarnings = lazy(() => import("@food/pages/admin/delivery-partners/DeliveryEarnings"));
// Disbursement Management
// Report Management
const TransactionReport = lazy(() => import("@food/pages/admin/reports/TransactionReport"));
const ExpenseReport = lazy(() => import("@food/pages/admin/reports/ExpenseReport"));
const DisbursementReportRestaurants = lazy(() => import("@food/pages/admin/reports/DisbursementReportRestaurants"));
const DisbursementReportDeliverymen = lazy(() => import("@food/pages/admin/reports/DisbursementReportDeliverymen"));
const RegularOrderReport = lazy(() => import("@food/pages/admin/reports/RegularOrderReport"));
const CampaignOrderReport = lazy(() => import("@food/pages/admin/reports/CampaignOrderReport"));
const RestaurantReport = lazy(() => import("@food/pages/admin/reports/RestaurantReport"));
const FeedbackExperienceReport = lazy(() => import("@food/pages/admin/reports/FeedbackExperienceReport"));
const TaxReport = lazy(() => import("@food/pages/admin/reports/TaxReport"));
const RestaurantVATReport = lazy(() => import("@food/pages/admin/reports/RestaurantVATReport"));
// Transaction Management
const RestaurantWithdraws = lazy(() => import("@food/pages/admin/transactions/RestaurantWithdraws"));
const WithdrawMethod = lazy(() => import("@food/pages/admin/transactions/WithdrawMethod"));
// Employee Management
const EmployeeRole = lazy(() => import("@food/pages/admin/employees/EmployeeRole"));
const AddEmployee = lazy(() => import("@food/pages/admin/employees/AddEmployee"));
const EmployeeList = lazy(() => import("@food/pages/admin/employees/EmployeeList"));
// Business Settings
const BusinessSetup = lazy(() => import("@food/pages/admin/settings/BusinessSetup"));
const PetpoojaSettings = lazy(() => import("@food/pages/admin/settings/PetpoojaSettings"));
const EmailTemplate = lazy(() => import("@food/pages/admin/settings/EmailTemplate"));
const ThemeSettings = lazy(() => import("@food/pages/admin/settings/ThemeSettings"));
const Gallery = lazy(() => import("@food/pages/admin/settings/Gallery"));
const LoginSetup = lazy(() => import("@food/pages/admin/settings/LoginSetup"));
const TermsAndCondition = lazy(() => import("@food/pages/admin/settings/TermsAndCondition"));
const PrivacyPolicy = lazy(() => import("@food/pages/admin/settings/PrivacyPolicy"));
const AboutUs = lazy(() => import("@food/pages/admin/settings/AboutUs"));
const RefundPolicy = lazy(() => import("@food/pages/admin/settings/RefundPolicy"));
const ShippingPolicy = lazy(() => import("@food/pages/admin/settings/ShippingPolicy"));
const CancellationPolicy = lazy(() => import("@food/pages/admin/settings/CancellationPolicy"));
const ReactRegistration = lazy(() => import("@food/pages/admin/settings/ReactRegistration"));
const HelpSupportContent = lazy(() => import("@food/pages/admin/settings/HelpSupportContent"));
// System Settings
const ThirdParty = lazy(() => import("@food/pages/admin/system/ThirdParty"));
const FirebaseNotification = lazy(() => import("@food/pages/admin/system/FirebaseNotification"));
const OfflinePaymentSetup = lazy(() => import("@food/pages/admin/system/OfflinePaymentSetup"));
const JoinUsPageSetup = lazy(() => import("@food/pages/admin/system/JoinUsPageSetup"));
const AnalyticsScript = lazy(() => import("@food/pages/admin/system/AnalyticsScript"));
const AISetup = lazy(() => import("@food/pages/admin/system/AISetup"));
const AppWebSettings = lazy(() => import("@food/pages/admin/system/AppWebSettings"));
const NotificationChannels = lazy(() => import("@food/pages/admin/system/NotificationChannels"));
const NotificationBroadcast = lazy(() => import("@food/pages/admin/system/NotificationBroadcast"));
const AdminNotifications = lazy(() => import("@food/pages/admin/system/AdminNotifications"));
const LandingPageSettings = lazy(() => import("@food/pages/admin/system/LandingPageSettings"));
const PageMetaData = lazy(() => import("@food/pages/admin/system/PageMetaData"));
const ReactSite = lazy(() => import("@food/pages/admin/system/ReactSite"));
const CleanDatabase = lazy(() => import("@food/pages/admin/system/CleanDatabase"));
const AddonActivation = lazy(() => import("@food/pages/admin/system/AddonActivation"));
const LandingPageManagement = lazy(() => import("@food/pages/admin/system/LandingPageManagement"));
const DiningManagement = lazy(() => import("@food/pages/admin/system/DiningManagement"));
const DiningList = lazy(() => import("@food/pages/admin/system/DiningList"));
const EditRestaurant = lazy(() => import("@food/pages/admin/restaurant/EditRestaurant"));
const AdminLogin = lazy(() => import("@food/pages/admin/auth/AdminLogin"));
const AdminSignup = lazy(() => import("@food/pages/admin/auth/AdminSignup"));
const AdminForgotPassword = lazy(() => import("@food/pages/admin/auth/AdminForgotPassword"));
const FoodSubadmins = lazy(() => import("@food/pages/admin/management/FoodSubadmins"));
const FoodSubadminCreate = lazy(() => import("@food/pages/admin/management/FoodSubadminCreate"));

export default function AdminRouter() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Protected Routes - With Layout */}
        {/* Admin Login - Same as earlier */}
        <Route path="login" element={<AdminLogin />} />
        <Route path="forgot-password" element={<AdminForgotPassword />} />
        <Route path="signup" element={<AdminSignup />} />

        {/* Protected Routes - With Layout */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          {/* Default Admin Redirect */}
          <Route path="/" element={<Navigate to="food" replace />} />

          {/* FOOD ADMIN - All food related routes nested here */}
          <Route path="food/*">
            <Route index element={<AdminHome />} />
            <Route path="point-of-sale" element={<PointOfSale />} />
            <Route path="status-monitor" element={<StatusMonitor />} />
            <Route path="profile" element={<AdminProfile />} />
            <Route path="settings" element={<AdminSettings />} />
            
            {/* ORDER MANAGEMENT */}
            <Route path="orders/all" element={<OrdersPage statusKey="all" />} />
            <Route path="orders/scheduled" element={<OrdersPage statusKey="scheduled" />} />
            <Route path="orders/pending" element={<OrdersPage statusKey="pending" />} />
            {/* ... other order routes ... */}
            <Route path="orders/accepted" element={<OrdersPage statusKey="accepted" />} />
            <Route path="orders/processing" element={<OrdersPage statusKey="processing" />} />
            <Route path="orders/food-on-the-way" element={<OrdersPage statusKey="food-on-the-way" />} />
            <Route path="orders/delivered" element={<OrdersPage statusKey="delivered" />} />
            <Route path="orders/canceled" element={<OrdersPage statusKey="canceled" />} />
            <Route path="orders/restaurant-cancelled" element={<OrdersPage statusKey="restaurant-cancelled" />} />
            <Route path="orders/payment-failed" element={<OrdersPage statusKey="payment-failed" />} />
            <Route path="orders/refunded" element={<OrdersPage statusKey="refunded" />} />
            <Route path="orders/offline-payments" element={<OrdersPage statusKey="offline-payments" />} />
            <Route path="order-detect-delivery" element={<OrderDetectDelivery />} />
            <Route path="order-refunds/new" element={<NewRefundRequests />} />

            {/* RESTAURANT MANAGEMENT */}
            <Route path="zone-setup" element={<ZoneSetup />} />
            <Route path="zone-setup/map" element={<AllZonesMap />} />
            <Route path="zone-setup/delivery-boy-view" element={<DeliveryBoyViewMap />} />
            <Route path="zone-setup/add" element={<AddZone />} />
            <Route path="zone-setup/edit/:id" element={<AddZone />} />
            <Route path="zone-setup/view/:id" element={<ViewZone />} />
            <Route path="food-approval" element={<FoodApproval />} />
            <Route path="restaurants" element={<RestaurantsList />} />
            <Route path="restaurants/add" element={<AddRestaurant />} />
            <Route path="restaurants/edit/:id" element={<EditRestaurant />} />
            <Route path="restaurants/joining-request" element={<JoiningRequest />} />
            <Route path="restaurants/commission" element={<RestaurantCommission />} />
            <Route path="restaurants/complaints" element={<RestaurantComplaints />} />
            <Route path="restaurants/reviews" element={<RestaurantReviews />} />
            <Route path="restaurants/bulk-import" element={<RestaurantsBulkImport />} />
            <Route path="restaurants/bulk-export" element={<RestaurantsBulkExport />} />

            {/* FOOD & CATEGORY MANAGEMENT */}
            <Route path="categories" element={<Category />} />
            <Route path="fee-settings" element={<FeeSettings />} />
            <Route path="referral-settings" element={<ReferralSettings />} />
            <Route path="foods" element={<FoodsList />} />
            <Route path="food/list" element={<FoodsList />} />
            <Route path="addons" element={<AddonsList />} />

            {/* PROMOTIONS, CUSTOMERS, DELIVERYMEN, etc. */}
            <Route path="campaigns/basic" element={<BasicCampaign />} />
            <Route path="campaigns/food" element={<FoodCampaign />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="cashback" element={<Cashback />} />
            <Route path="banners" element={<Banners />} />
            <Route path="promotional-banner" element={<PromotionalBanner />} />
            <Route path="advertisement" element={<AdsList />} />
            <Route path="advertisement/new" element={<NewAdvertisement />} />
            <Route path="advertisement/requests" element={<AdRequests />} />
            
            <Route path="chattings" element={<Chattings />} />
            <Route path="contact-messages" element={<ContactMessages />} />
            <Route path="safety-emergency-reports" element={<SafetyEmergencyReports />} />
            
            <Route path="customers" element={<Customers />} />
            <Route path="support-tickets" element={<SupportTickets />} />
            <Route path="wallet/add-fund" element={<AddFund />} />
            <Route path="wallet/bonus" element={<Bonus />} />
            <Route path="loyalty-point/report" element={<LoyaltyPointReport />} />
            <Route path="subscribed-mail-list" element={<SubscribedMailList />} />

            <Route path="delivery-cash-limit" element={<DeliveryCashLimit />} />
            <Route path="cash-limit-settlement" element={<CashLimitSettlement />} />
            <Route path="delivery-withdrawal" element={<DeliveryWithdrawal />} />
            <Route path="delivery-boy-wallet" element={<DeliveryBoyWallet />} />
            <Route path="delivery-emergency-help" element={<DeliveryEmergencyHelp />} />
            <Route path="delivery-support-tickets" element={<DeliverySupportTickets />} />
            <Route path="delivery-partners" element={<DeliverymanList />} />
            <Route path="delivery-partners/add" element={<AddDeliveryman />} />
            <Route path="delivery-partners/join-request" element={<JoinRequest />} />
            <Route path="delivery-partners/reviews" element={<DeliverymanReviews />} />
            <Route path="delivery-partners/bonus" element={<DeliverymanBonus />} />
            <Route path="delivery-partners/earning-addon" element={<EarningAddon />} />
            <Route path="delivery-partners/earning-addon-history" element={<EarningAddonHistory />} />
            <Route path="delivery-partners/earnings" element={<DeliveryEarnings />} />


            {/* REPORTS & SETTINGS */}
            <Route path="transaction-report" element={<TransactionReport />} />
            <Route path="expense-report" element={<ExpenseReport />} />
            <Route path="disbursement-report/restaurants" element={<DisbursementReportRestaurants />} />
            <Route path="disbursement-report/deliverymen" element={<DisbursementReportDeliverymen />} />
            <Route path="order-report/regular" element={<RegularOrderReport />} />
            <Route path="order-report/campaign" element={<CampaignOrderReport />} />
            <Route path="restaurant-report" element={<RestaurantReport />} />
            <Route path="customer-report/feedback-experience" element={<FeedbackExperienceReport />} />
            <Route path="tax-report" element={<TaxReport />} />
            <Route path="restaurant-vat-report" element={<RestaurantVATReport />} />
            
            <Route path="restaurant-withdraws" element={<RestaurantWithdraws />} />
            <Route path="withdraw-method" element={<WithdrawMethod />} />
            
             <Route path="employee-role" element={<Navigate to="../management/admins" replace />} />
             <Route path="employees" element={<Navigate to="../management/admins" replace />} />
             <Route path="employees/add" element={<Navigate to="../management/admins/create" replace />} />

            {/* SUBADMIN MANAGEMENT */}
            <Route path="management/admins" element={<FoodSubadmins />} />
            <Route path="management/admins/create" element={<FoodSubadminCreate />} />
            <Route path="management/admins/edit/:id" element={<FoodSubadminCreate />} />

            {/* SYSTEM & BUSINESS SETTINGS */}
            <Route path="business-setup" element={<BusinessSetup />} />
            <Route path="petpooja-settings" element={<PetpoojaSettings />} />
            <Route path="email-template" element={<EmailTemplate />} />
            <Route path="theme-settings" element={<ThemeSettings />} />
            <Route path="gallery" element={<Gallery />} />
            <Route path="login-setup" element={<LoginSetup />} />
            <Route path="business-settings/fcm-index" element={<FirebaseNotification />} />
            <Route path="pages-social-media/terms" element={<TermsAndCondition />} />
            <Route path="pages-social-media/privacy" element={<PrivacyPolicy />} />
            <Route path="pages-social-media/about" element={<AboutUs />} />
            <Route path="pages-social-media/refund" element={<RefundPolicy />} />
            <Route path="pages-social-media/shipping" element={<ShippingPolicy />} />
            <Route path="pages-social-media/cancellation" element={<CancellationPolicy />} />
            <Route path="pages-social-media/react-registration" element={<ReactRegistration />} />
            <Route path="pages-social-media/help-support" element={<HelpSupportContent />} />
            
            <Route path="3rd-party-configurations/party" element={<ThirdParty />} />
            <Route path="3rd-party-configurations/firebase" element={<FirebaseNotification />} />
            <Route path="3rd-party-configurations/offline-payment" element={<OfflinePaymentSetup />} />
            <Route path="3rd-party-configurations/join-us" element={<JoinUsPageSetup />} />
            <Route path="3rd-party-configurations/analytics" element={<AnalyticsScript />} />
            <Route path="3rd-party-configurations/ai" element={<AISetup />} />
            <Route path="app-web-settings" element={<AppWebSettings />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="broadcast-notification" element={<NotificationBroadcast />} />
            <Route path="notification-channels" element={<NotificationChannels />} />
            <Route path="landing-page-settings/admin" element={<LandingPageSettings type="admin" />} />
            <Route path="landing-page-settings/react" element={<LandingPageSettings type="react" />} />
            <Route path="page-meta-data" element={<PageMetaData />} />
            <Route path="react-site" element={<ReactSite />} />
            <Route path="clean-database" element={<CleanDatabase />} />
            <Route path="addon-activation" element={<AddonActivation />} />
            <Route path="hero-banner-management" element={<LandingPageManagement />} />
            <Route path="dining-management" element={<DiningManagement />} />
            <Route path="dining-list" element={<DiningList />} />
          </Route>

          {/* TAXI ADMIN - Redirect to integrated taxi admin */}
          <Route path="taxi/*" element={<Navigate to="/taxi/admin/dashboard" replace />} />

          {/* QUICK COMMERCE ADMIN - Placeholder for future implementation */}
          <Route path="quick-commerce/*" element={<div className="p-8 text-center text-gray-500 bg-white min-h-[50vh] flex items-center justify-center border rounded-xl m-4">Quick Commerce Administration - Coming Soon</div>} />
        </Route>

        {/* Redirect unknown admin routes to food admin */}
        <Route path="*" element={<Navigate to="/admin/food" replace />} />
      </Routes>
    </Suspense>
  );
}
