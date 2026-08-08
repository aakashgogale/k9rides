import mongoose from 'mongoose';

/**
 * Singleton store for the platform's global PetPooja credentials.
 * Setup: one PetPooja account (app-key + client-code), many outlets — each
 * restaurant carries only its own `petpoojaOutletId`. Admin-editable so keys
 * no longer live in env. Env values act as a fallback when a field is blank.
 */
const petpoojaSettingsSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        apiKey: { type: String, default: '' },
        clientCode: { type: String, default: '' },
        apiUrl: { type: String, default: 'https://api.petpooja.com/v2' },
    },
    { collection: 'food_petpooja_settings', timestamps: true }
);

export const FoodPetpoojaSettings = mongoose.model('FoodPetpoojaSettings', petpoojaSettingsSchema);
