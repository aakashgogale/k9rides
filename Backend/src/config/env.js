import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const generateRandomSecret = (name) => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(`[env] ❌ Critical Security Error: ${name} environment variable is required in production mode!`);
    }   
    const fallback = crypto.randomBytes(32).toString('hex');
    console.warn(`[env] ⚠️ ${name} environment variable is not set. Generated a random secure fallback secret.`);
    return fallback;
};

const parseOrigins = (value) =>
    String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

const fallbackCorsOrigins = [
    ...parseOrigins(process.env.SOCKET_CORS_ORIGIN),
    ...parseOrigins(process.env.FRONTEND_URL),
];
const uniqueCorsOrigins = [...new Set(fallbackCorsOrigins)];
const resolvedCorsOrigin = uniqueCorsOrigins.length > 0 ? uniqueCorsOrigins.join(',') : '*';

export const config = {
    // Basic server config
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    mongodbUri: process.env.MONGO_URI || process.env.MONGODB_URI,
    mongodbDnsServers: process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1',
    mongodbServerSelectionTimeoutMs: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 30000),
    mongodbConnectTimeoutMs: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || 30000),

    // JWT
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || generateRandomSecret('JWT_ACCESS_SECRET'),
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || generateRandomSecret('JWT_REFRESH_SECRET'),
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',

    // OTP
    otpExpiry: process.env.OTP_EXPIRY || '5m',
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpExpirySeconds: Number(process.env.OTP_EXPIRY_SECONDS || 300),
    otpRateLimit: Number(process.env.OTP_RATE_LIMIT || 3),
    otpRateWindow: Number(process.env.OTP_RATE_WINDOW || 600),
    useDefaultOtp: process.env.USE_DEFAULT_OTP === 'true',

    // SMS India Hub
    smsIndiaHubUsername: process.env.SMS_INDIA_HUB_USERNAME,
    smsApiKey: process.env.SMS_INDIA_HUB_API_KEY,
    smsSenderId: process.env.SMS_INDIA_HUB_SENDER_ID,
    smsDltTemplateId: process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID,

    // Rate limiting
    rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW || 15),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX || 100),
    authRateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW || 15),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),

    // Security
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),

    // Uploads
    uploadPath: process.env.UPLOAD_PATH || 'uploads/',
    requestJsonLimit: process.env.REQUEST_JSON_LIMIT || '2mb',
    requestUrlencodedLimit: process.env.REQUEST_URLENCODED_LIMIT || '2mb',

    // Redis
    redisEnabled: process.env.REDIS_ENABLED === 'true',
    redisUrl: process.env.REDIS_URL,

    // BullMQ
    bullmqEnabled: process.env.BULLMQ_ENABLED === 'true',

    // Cloudinary
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,

    // Firebase / FCM
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    firebaseDatabaseUrl: process.env.VITE_FIREBASE_DATABASE_URL,
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
    firebaseWebApiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    firebaseWebAuthDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    firebaseWebStorageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    firebaseWebMessagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseWebAppId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    firebaseWebMeasurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID,
    firebaseWebVapidKey: process.env.VITE_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY,

    // Socket.io
    socketCorsOrigin: resolvedCorsOrigin,

    // Razorpay (payments)
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, // ✅ NEW

    // Email (SMTP) – for admin forgot password OTP etc.
    emailHost: process.env.EMAIL_HOST,
    emailPort: Number(process.env.EMAIL_PORT) || 587,
    emailUser: process.env.EMAIL_USER,
    emailPass: process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s/g, '') : '',
    emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@example.com',

    // WhatsApp (Meta Cloud API)
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    whatsappVersion: process.env.WHATSAPP_VERSION || 'v20.0',
    whatsappUseTemplate: process.env.WHATSAPP_USE_TEMPLATE === 'true',
    whatsappFoodTemplateName: process.env.WHATSAPP_FOOD_TEMPLATE_NAME || 'food_invoice',
    whatsappTaxiTemplateName: process.env.WHATSAPP_TAXI_TEMPLATE_NAME || 'taxi_invoice',

    // Petpooja Integration
    petpoojaEnabled: process.env.PETPOOJA_ENABLED === 'true',
    petpoojaApiKey: process.env.PETPOOJA_API_KEY || '',
    petpoojaClientCode: process.env.PETPOOJA_CLIENT_CODE || '',
    petpoojaOutletId: process.env.PETPOOJA_OUTLET_ID || '',
    petpoojaApiUrl: process.env.PETPOOJA_API_URL || 'https://api.petpooja.com/v2',

    // Driver unification: when true, dispatch treats taxi drivers + delivery partners as one
    // pool and honors workMode + the activeAssignment busy-lock. Default OFF for safe dual-run —
    // flip only after the backfill migration has run and been validated on staging.
    unifiedDispatchEnabled: process.env.UNIFIED_DISPATCH_ENABLED === 'true'
};

// Taxi Module Compatibility Export
export const env = {
    ...config,
    // Taxi modules use `env.corsOrigin`; keep it in sync with socket CORS origin.
    corsOrigin: config.socketCorsOrigin,
    mongoUri: config.mongodbUri,
    jwtSecret: config.jwtAccessSecret,
    jwtExpiresIn: config.jwtAccessExpiresIn,
    cloudinary: {
        cloudName: config.cloudinaryCloudName,
        apiKey: config.cloudinaryApiKey,
        apiSecret: config.cloudinaryApiSecret,
        folder: process.env.CLOUDINARY_FOLDER || 'K9 Rides-taxi',
    },
    firebase: {
        databaseURL: config.firebaseDatabaseUrl,
        serviceAccountPath: config.firebaseServiceAccountPath,
        serviceAccountJson: config.firebaseServiceAccount,
    },
    sms: {
        useDefaultOtp: config.useDefaultOtp ? 'true' : 'false',
        otpExpiryMinutes: config.otpExpiryMinutes,
        staticOtpPhone: process.env.STATIC_OTP_PHONE,
        staticOtpCode: process.env.STATIC_OTP_CODE,
        indiaHub: {
            username: config.smsIndiaHubUsername,
            password: process.env.SMS_INDIA_HUB_PASSWORD,
            apiKey: config.smsApiKey,
            senderId: config.smsSenderId,
            dltTemplateId: config.smsDltTemplateId,
        }
    },
    driverWallet: {
        defaultCashLimit: Number(process.env.DRIVER_WALLET_DEFAULT_CASH_LIMIT || 500),
        commissionPercent: Number(process.env.DRIVER_COMMISSION_PERCENT || 20),
    }
};

export const isOriginAllowed = (origin) => {
    if (!origin) return true; // Allow non-browser requests (e.g. mobile apps, curl)

    // Parse configured allowed origins
    const allowed = String(config.socketCorsOrigin || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    const list = allowed.length > 0 ? allowed : ['https://k9rides.onrender.com'];

    if (list.includes('*') || list.includes(origin)) {
        return true;
    }

    try {
        const url = new URL(origin);
        if (
            url.hostname.endsWith('.vercel.app') ||
            url.hostname.endsWith('.k9rides.com') ||
            url.hostname === 'k9rides.com' ||
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1'
        ) {
            return true;
        }
    } catch (_) { }

    return false;
};

