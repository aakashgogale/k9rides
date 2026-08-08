import { FoodBusinessSettings } from '../models/businessSettings.model.js';
import { FoodPetpoojaSettings } from '../models/petpoojaSettings.model.js';
import { sendResponse } from '../../../../utils/response.js';
import { uploadImageBufferDetailed } from '../../../../services/cloudinary.service.js';

const maskSecret = (value) => {
    const str = String(value || '');
    if (!str) return '';
    if (str.length <= 4) return '••••';
    return `${'•'.repeat(Math.max(4, str.length - 4))}${str.slice(-4)}`;
};

/**
 * Returns the platform's global PetPooja credentials for the admin panel.
 * Secrets are masked; `hasApiKey`/`hasClientCode` tell the UI whether a value is set.
 */
export async function getPetpoojaSettings(req, res, next) {
    try {
        let settings = await FoodPetpoojaSettings.findOne().lean();
        if (!settings) {
            settings = await FoodPetpoojaSettings.create({});
            settings = settings.toObject();
        }
        return sendResponse(res, 200, 'PetPooja settings fetched successfully', {
            enabled: settings.enabled,
            apiUrl: settings.apiUrl,
            apiKeyMasked: maskSecret(settings.apiKey),
            clientCodeMasked: maskSecret(settings.clientCode),
            hasApiKey: Boolean(settings.apiKey),
            hasClientCode: Boolean(settings.clientCode),
            updatedAt: settings.updatedAt,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Updates the global PetPooja credentials from the admin panel.
 * apiKey / clientCode are only overwritten when a non-empty value is supplied,
 * so the admin isn't forced to re-enter secrets on every save.
 */
export async function updatePetpoojaSettings(req, res, next) {
    try {
        const { enabled, apiKey, clientCode, apiUrl } = req.body || {};

        let settings = await FoodPetpoojaSettings.findOne();
        if (!settings) settings = new FoodPetpoojaSettings();

        if (enabled !== undefined) settings.enabled = Boolean(enabled);
        if (apiUrl !== undefined) {
            if (apiUrl && !/^https?:\/\/.+/i.test(String(apiUrl).trim())) {
                return res.status(400).json({ success: false, message: 'apiUrl must be a valid http(s) URL' });
            }
            if (apiUrl) settings.apiUrl = String(apiUrl).trim();
        }
        if (typeof apiKey === 'string' && apiKey.trim()) settings.apiKey = apiKey.trim();
        if (typeof clientCode === 'string' && clientCode.trim()) settings.clientCode = clientCode.trim();

        // Guard: can't enable the integration without both credentials present.
        if (settings.enabled && (!settings.apiKey || !settings.clientCode)) {
            return res.status(400).json({ success: false, message: 'apiKey and clientCode are required to enable PetPooja' });
        }

        await settings.save();
        return sendResponse(res, 200, 'PetPooja settings updated successfully', {
            enabled: settings.enabled,
            apiUrl: settings.apiUrl,
            apiKeyMasked: maskSecret(settings.apiKey),
            clientCodeMasked: maskSecret(settings.clientCode),
            hasApiKey: Boolean(settings.apiKey),
            hasClientCode: Boolean(settings.clientCode),
        });
    } catch (error) {
        next(error);
    }
}

export async function getBusinessSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne().lean();
        if (!settings) {
            // Create default settings if none exist
            settings = await FoodBusinessSettings.create({
                companyName: 'K9 Rides',
                email: 'admin@K9 Rides.com'
            });
        }
        return sendResponse(res, 200, 'Business settings fetched successfully', settings);
    } catch (error) {
        next(error);
    }
}

export async function updateBusinessSettings(req, res, next) {
    try {
        const data = req.body.data ? JSON.parse(req.body.data) : {};
        const { companyName, email, phoneCountryCode, phoneNumber, address, state, pincode, region } = data;

        // Validation
        if (!companyName || companyName.trim().length < 2 || companyName.trim().length > 50) {
            return res.status(400).json({ success: false, message: 'Company name must be between 2 and 50 characters' });
        }
        if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid email address (max 100 characters)' });
        }
        if (!phoneNumber || !/^\d{7,15}$/.test(phoneNumber.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid phone number (7-15 digits required)' });
        }
        if (address && address.length > 250) {
            return res.status(400).json({ success: false, message: 'Address is too long (max 250 characters)' });
        }
        if (state && state.length > 50) {
            return res.status(400).json({ success: false, message: 'State name is too long (max 50 characters)' });
        }
        if (pincode && !/^\d{4,10}$/.test(pincode.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid pincode (4-10 digits required)' });
        }

        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings();
        }

        if (companyName) settings.companyName = companyName;
        if (email) settings.email = email;
        if (phoneCountryCode || phoneNumber) {
            settings.phone = {
                countryCode: phoneCountryCode || settings.phone?.countryCode || '+91',
                number: phoneNumber || settings.phone?.number || ''
            };
        }
        if (address !== undefined) settings.address = address;
        if (state !== undefined) settings.state = state;
        if (pincode !== undefined) settings.pincode = pincode;
        if (region) settings.region = region;

        // Handle file uploads
        if (req.files) {
            if (req.files.logo) {
                const logoResult = await uploadImageBufferDetailed(req.files.logo[0].buffer, 'business/logos');
                settings.logo = {
                    url: logoResult.secure_url,
                    publicId: logoResult.public_id
                };
            }
            if (req.files.favicon) {
                const faviconResult = await uploadImageBufferDetailed(req.files.favicon[0].buffer, 'business/favicons');
                settings.favicon = {
                    url: faviconResult.secure_url,
                    publicId: faviconResult.public_id
                };
            }
            if (req.files.restaurantLogo) {
                const logoResult = await uploadImageBufferDetailed(req.files.restaurantLogo[0].buffer, 'business/restaurantLogos');
                settings.restaurantLogo = {
                    url: logoResult.secure_url,
                    publicId: logoResult.public_id
                };
            }
            if (req.files.deliveryPartnerLogo) {
                const logoResult = await uploadImageBufferDetailed(req.files.deliveryPartnerLogo[0].buffer, 'business/deliveryPartnerLogos');
                settings.deliveryPartnerLogo = {
                    url: logoResult.secure_url,
                    publicId: logoResult.public_id
                };
            }
        }

        await settings.save();
        return sendResponse(res, 200, 'Business settings updated successfully', settings);
    } catch (error) {
        next(error);
    }
}

