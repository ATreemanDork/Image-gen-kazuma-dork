/**
 * Settings persistence module
 * Handles validated loading/saving of extension settings
 * Pattern adapted from rpg-companion-sillytavern best practices
 */

import { DEFAULT_SETTINGS, VALIDATION_RANGES } from './constants.js';
import { debugLog, errorLog, warnLog } from './logger.js';
import { validateSettings } from './utils.js';

const extensionName = 'Image-gen-kazuma-dork';

/**
 * Validates extension settings structure
 * @param {object} settings - Settings object to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateSettingsStructure(settings) {
    if (!settings || typeof settings !== 'object') {
        return false;
    }

    // Check for required top-level properties
    if (typeof settings.enabled !== 'boolean' ||
        typeof settings.debugLogging !== 'boolean' ||
        typeof settings.comfyUrl !== 'string') {
        warnLog('Settings validation failed: missing required properties');
        return false;
    }

    // Check numeric fields are in valid ranges
    const numericFields = ['steps', 'cfg', 'denoise', 'clipSkip', 'width', 'height'];
    for (const field of numericFields) {
        if (field in settings) {
            const value = settings[field];
            if (typeof value !== 'number' || isNaN(value)) {
                warnLog(`Settings validation failed: ${field} is not a valid number`);
                return false;
            }
        }
    }

    return true;
}

/**
 * Loads extension settings with validation and fallback
 * @param {object} stAPI - SillyTavern API references
 * @returns {object} Validated settings object
 */
export function loadSettings(stAPI) {
    try {
        const { extension_settings, getExtensionSettings } = stAPI;

        // Try to get settings store
        let settingsStore = null;
        if (typeof getExtensionSettings === 'function') {
            settingsStore = getExtensionSettings();
        } else if (extension_settings && typeof extension_settings === 'object') {
            settingsStore = extension_settings;
        }

        if (!settingsStore) {
            warnLog('Settings store not available, using defaults');
            return { ...DEFAULT_SETTINGS };
        }

        // Check if extension settings exist
        if (!settingsStore[extensionName]) {
            debugLog('No saved settings found, initializing with defaults');
            settingsStore[extensionName] = { ...DEFAULT_SETTINGS };
            saveSettings(stAPI, settingsStore[extensionName]);
            return settingsStore[extensionName];
        }

        const savedSettings = settingsStore[extensionName];

        // Validate settings structure
        if (!validateSettingsStructure(savedSettings)) {
            errorLog('Saved settings failed validation, resetting to defaults');
            settingsStore[extensionName] = { ...DEFAULT_SETTINGS };
            saveSettings(stAPI, settingsStore[extensionName]);
            return settingsStore[extensionName];
        }

        // Validate and clamp numeric values
        const validatedSettings = validateSettings(savedSettings);

        // Merge with defaults to ensure new fields are present
        const mergedSettings = { ...DEFAULT_SETTINGS, ...validatedSettings };

        // Perform settings migrations based on version
        const currentVersion = mergedSettings.settingsVersion || 1;
        let settingsChanged = false;

        // Migration to version 2: Example for future use
        // if (currentVersion < 2) {
        //     debugLog('Migrating settings to version 2');
        //     mergedSettings.newField = defaultValue;
        //     mergedSettings.settingsVersion = 2;
        //     settingsChanged = true;
        // }

        // Save migrated settings if changed
        if (settingsChanged) {
            settingsStore[extensionName] = mergedSettings;
            saveSettings(stAPI, mergedSettings);
        }

        debugLog('Settings loaded and validated successfully');
        return mergedSettings;

    } catch (error) {
        errorLog('Error loading settings:', error.message);
        warnLog('Using default settings due to load error');
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Saves extension settings with validation
 * @param {object} stAPI - SillyTavern API references
 * @param {object} settings - Settings object to save
 * @returns {boolean} True if saved successfully
 */
export function saveSettings(stAPI, settings) {
    try {
        const { extension_settings, getExtensionSettings, saveSettingsDebounced } = stAPI;

        // Get settings store
        let settingsStore = null;
        if (typeof getExtensionSettings === 'function') {
            settingsStore = getExtensionSettings();
        } else if (extension_settings && typeof extension_settings === 'object') {
            settingsStore = extension_settings;
        }

        if (!settingsStore) {
            errorLog('Cannot save settings: settings store not available');
            return false;
        }

        // Validate before saving
        if (!validateSettingsStructure(settings)) {
            errorLog('Cannot save settings: validation failed');
            return false;
        }

        // Save to store
        settingsStore[extensionName] = settings;

        // Trigger debounced save
        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
            debugLog('Settings saved successfully');
            return true;
        } else {
            warnLog('saveSettingsDebounced not available');
            return false;
        }

    } catch (error) {
        errorLog('Error saving settings:', error.message);
        return false;
    }
}

/**
 * Resets settings to defaults
 * @param {object} stAPI - SillyTavern API references
 * @returns {object} Default settings object
 */
export function resetSettings(stAPI) {
    const defaults = { ...DEFAULT_SETTINGS };
    saveSettings(stAPI, defaults);
    debugLog('Settings reset to defaults');

    if (typeof toastr !== 'undefined') {
        toastr.info('Settings reset to defaults');
    }

    return defaults;
}

/**
 * Exports settings to JSON string
 * @param {object} settings - Settings object to export
 * @returns {string} JSON string of settings
 */
export function exportSettingsToJSON(settings) {
    try {
        const exportData = JSON.stringify(settings, null, 2);

        // Save to localStorage as backup
        try {
            localStorage.setItem(`${extensionName}_backup`, exportData);
        } catch (e) {
            warnLog('Failed to save backup to localStorage:', e.message);
        }

        debugLog('Settings exported to JSON');
        return exportData;

    } catch (error) {
        errorLog('Failed to export settings:', error.message);
        throw error;
    }
}

/**
 * Imports settings from JSON with validation
 * @param {object} stAPI - SillyTavern API references
 * @param {string|object} source - JSON string, object, or 'localStorage'/'clipboard'
 * @returns {Promise<object>} Imported and validated settings
 */
export async function importSettingsFromJSON(stAPI, source) {
    let importedData;

    try {
        if (source === 'localStorage') {
            const stored = localStorage.getItem(`${extensionName}_backup`);
            if (!stored) {
                throw new Error('No backup found in localStorage');
            }
            importedData = JSON.parse(stored);

        } else if (source === 'clipboard') {
            const text = await navigator.clipboard.readText();
            importedData = JSON.parse(text);

        } else if (typeof source === 'string') {
            importedData = JSON.parse(source);

        } else if (typeof source === 'object') {
            importedData = source;

        } else {
            throw new Error('Invalid import source');
        }

        // Validate imported data
        if (!validateSettingsStructure(importedData)) {
            throw new Error('Imported settings failed validation');
        }

        // Validate and clamp values
        const validated = validateSettings(importedData);

        // Merge with defaults to ensure all fields present
        const merged = { ...DEFAULT_SETTINGS, ...validated };

        // Save the imported settings
        saveSettings(stAPI, merged);

        debugLog('Settings imported and validated successfully');

        if (typeof toastr !== 'undefined') {
            toastr.success('Settings imported successfully');
        }

        return merged;

    } catch (error) {
        errorLog('Failed to import settings:', error.message);
        if (typeof toastr !== 'undefined') {
            toastr.error(`Import failed: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Gets settings for preset export (only portable settings)
 * @param {object} settings - Full settings object
 * @returns {object} Filtered settings suitable for presets
 */
export function getPresetSettings(settings) {
    // Export all settings except runtime-only fields
    const {
        // Exclude runtime state that shouldn't travel with presets
        ...presetSettings
    } = settings;

    return presetSettings;
}

/**
 * Applies preset settings with validation
 * @param {object} stAPI - SillyTavern API references
 * @param {object} currentSettings - Current settings object
 * @param {object} presetSettings - Settings from preset
 * @returns {object} Merged settings
 */
export function applyPresetSettings(stAPI, currentSettings, presetSettings) {
    try {
        // Validate preset settings
        if (!validateSettingsStructure(presetSettings)) {
            throw new Error('Preset settings failed validation');
        }

        const validated = validateSettings(presetSettings);

        // Merge preset into current settings
        const merged = { ...currentSettings, ...validated };

        // Save merged settings
        saveSettings(stAPI, merged);

        debugLog('Preset settings applied successfully');

        if (typeof toastr !== 'undefined') {
            toastr.success('Preset applied successfully');
        }

        return merged;

    } catch (error) {
        errorLog('Failed to apply preset settings:', error.message);
        if (typeof toastr !== 'undefined') {
            toastr.error(`Failed to apply preset: ${error.message}`);
        }
        throw error;
    }
}
