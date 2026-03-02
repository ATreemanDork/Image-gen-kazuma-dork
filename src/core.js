/**
 * Core extension module
 * Handles lifecycle, settings management, and cleanup
 */

import { DEFAULT_SETTINGS, QUALITY_PRESETS } from './constants.js';
import { setDebugMode, debugLog, errorLog, warnLog } from './logger.js';
import { sanitizeErrorMessage, validateSettings } from './utils.js';
import { clearGenerationCache } from './cache.js';
import { clearAvatarCache } from './generation.js';
import { cancelBatch, clearBatchQueue } from './batch.js';
import * as persistence from './persistence.js';

/**
 * Extension name constant
 */
const extensionName = "Image-gen-kazuma-dork";

/**
 * Extension state namespace (prevents global pollution)
 */
export const kazumaExtension = {
    enabled: false,
    initialized: false,
    settings: null,     // Cached settings object (loaded via persistence)
    cleanup: {
        listeners: [],      // Event listeners to remove
        intervals: [],      // Intervals to clear
        timeouts: [],       // Timeouts to clear
        observers: []       // Mutation observers to disconnect
    },
    // SillyTavern API references (injected during init)
    stAPI: {
        extension_settings: null,
        getExtensionSettings: null,
        getContext: null,
        saveSettingsDebounced: null,
        eventSource: null,
        event_types: null,
        generateQuietPrompt: null,
        getRequestHeaders: null,
        appendMediaToMessage: null
    }
};

/**
 * Auto-generation counter
 */
let autoGenCounter = 0;

/**
 * Initialize SillyTavern API references
 * @param {object} APIs - Object containing ST API references
 */
export function initializeAPIs(APIs) {
    Object.assign(kazumaExtension.stAPI, APIs);
    debugLog('SillyTavern APIs initialized');
}

/**
 * Get extension settings (validated and cached)
 * @returns {object} Extension settings object
 */
export function getSettings() {
    // Return cached settings if available and initialized
    if (kazumaExtension.settings && kazumaExtension.initialized) {
        return kazumaExtension.settings;
    }

    // If not initialized, try to load from persistence
    if (kazumaExtension.stAPI.extension_settings) {
        try {
            kazumaExtension.settings = persistence.loadSettings(kazumaExtension.stAPI);
            return kazumaExtension.settings;
        } catch (error) {
            errorLog('Failed to load settings, using defaults:', error.message);
            kazumaExtension.settings = { ...DEFAULT_SETTINGS };
            return kazumaExtension.settings;
        }
    }

    // Fallback to defaults if API not ready
    warnLog('Settings requested before API ready, returning defaults');
    return { ...DEFAULT_SETTINGS };
}

/**
 * Update extension settings
 * @param {object} partial - Partial settings to merge
 */
export function updateSettings(partial) {
    const settings = getSettings();

    // Merge partial into current settings
    Object.assign(settings, partial);

    // Save via persistence module
    persistence.saveSettings(kazumaExtension.stAPI, settings);

    debugLog('Settings updated:', Object.keys(partial));
}

/**
 * Reset settings to defaults
 */
export function resetSettings() {
    kazumaExtension.settings = persistence.resetSettings(kazumaExtension.stAPI);
    debugLog('Settings reset to defaults');
}

/**
 * Export settings to JSON
 * @returns {string} JSON string of settings
 */
export function exportSettings() {
    const settings = getSettings();
    const exportData = persistence.exportSettingsToJSON(settings);

    // Copy to clipboard
    navigator.clipboard.writeText(exportData).then(() => {
        debugLog('Settings exported to clipboard and localStorage');
        if (typeof toastr !== 'undefined') {
            toastr.success('Settings exported to clipboard and localStorage');
        }
    }).catch(error => {
        warnLog('Failed to copy to clipboard:', error.message);
        if (typeof toastr !== 'undefined') {
            toastr.info('Settings saved to localStorage only');
        }
    });

    return exportData;
}

/**
 * Import settings from various sources
 * @param {string|object} source - 'localStorage', 'clipboard', JSON string, or object
 * @returns {Promise<object>} Imported settings
 */
export async function importSettings(source) {
    try {
        kazumaExtension.settings = await persistence.importSettingsFromJSON(kazumaExtension.stAPI, source);
        return kazumaExtension.settings;
    } catch (error) {
        errorLog('Failed to import settings:', error.message);
        throw error;
    }
}

/**
 * Apply quality preset
 * @param {string} presetName - Preset name (low, medium, high, ultra)
 * @returns {boolean} Whether preset was applied
 */
export function applyQualityPreset(presetName) {
    const preset = QUALITY_PRESETS[presetName];

    if (!preset) {
        warnLog(`Unknown quality preset: ${presetName}`);
        return false;
    }

    updateSettings({ ...preset.settings, qualityPreset: presetName });

    debugLog(`Quality preset applied: ${presetName}`);

    if (typeof toastr !== 'undefined') {
        toastr.success(`Quality preset "${preset.label}" applied`);
    }

    return true;
}

/**
 * Save prompt template
 * @param {string} name - Template name
 * @param {object} config - Template configuration
 */
export function savePromptTemplate(name, config) {
    if (!name || !name.trim()) {
        if (typeof toastr !== 'undefined') {
            toastr.error('Template name is required');
        }
        return;
    }

    const settings = getSettings();

    if (!settings.promptTemplates) {
        settings.promptTemplates = {};
    }

    settings.promptTemplates[name.trim()] = {
        style: config.style || settings.promptStyle,
        perspective: config.perspective || settings.promptPerspective,
        artStyle: config.artStyle || settings.promptArtStyle,
        extra: config.extra || settings.promptExtra
    };

    persistence.saveSettings(kazumaExtension.stAPI, settings);

    debugLog(`Prompt template saved: ${name}`);

    if (typeof toastr !== 'undefined') {
        toastr.success(`Template "${name}" saved`);
    }
}

/**
 * Load prompt template
 * @param {string} name - Template name
 * @returns {object|null} Template config or null if not found
 */
export function loadPromptTemplate(name) {
    const settings = getSettings();
    const template = settings.promptTemplates?.[name];

    if (!template) {
        warnLog(`Template not found: ${name}`);
        return null;
    }

    updateSettings(template);

    debugLog(`Prompt template loaded: ${name}`);

    if (typeof toastr !== 'undefined') {
        toastr.success(`Template "${name}" loaded`);
    }

    return template;
}

/**
 * Delete prompt template
 * @param {string} name - Template name
 */
export function deletePromptTemplate(name) {
    const settings = getSettings();

    if (settings.promptTemplates?.[name]) {
        delete settings.promptTemplates[name];

        persistence.saveSettings(kazumaExtension.stAPI, settings);

        debugLog(`Prompt template deleted: ${name}`);

        if (typeof toastr !== 'undefined') {
            toastr.success(`Template "${name}" deleted`);
        }
    }
}

/**
 * Get all prompt template names
 * @returns {string[]} Array of template names
 */
export function getPromptTemplates() {
    const settings = getSettings();
    return Object.keys(settings.promptTemplates || {});
}

/**
 * Enable extension
 */
export function enable() {
    if (kazumaExtension.enabled) {
        debugLog('Extension already enabled');
        return;
    }

    kazumaExtension.enabled = true;
    updateSettings({ enabled: true });

    debugLog('Extension enabled');

    if (typeof toastr !== 'undefined') {
        toastr.info('Image Gen Kazuma enabled');
    }
}

/**
 * Disable extension and run cleanup
 */
export function disable() {
    if (!kazumaExtension.enabled) {
        debugLog('Extension already disabled');
        return;
    }

    kazumaExtension.enabled = false;
    updateSettings({ enabled: false });

    // Run cleanup
    cleanup();

    debugLog('Extension disabled');

    if (typeof toastr !== 'undefined') {
        toastr.info('Image Gen Kazuma disabled');
    }
}

/**
 * Cleanup function - removes all listeners, intervals, and observers
 * CRITICAL for preventing memory leaks
 */
export function cleanup() {
    debugLog('Running cleanup...');

    const { eventSource } = kazumaExtension.stAPI;

    // Remove event listeners
    kazumaExtension.cleanup.listeners.forEach(({ event, handler }) => {
        if (eventSource && eventSource.removeListener) {
            eventSource.removeListener(event, handler);
            debugLog(`Removed event listener: ${event}`);
        }
    });
    kazumaExtension.cleanup.listeners = [];

    // Clear intervals
    kazumaExtension.cleanup.intervals.forEach(id => {
        clearInterval(id);
        debugLog(`Cleared interval: ${id}`);
    });
    kazumaExtension.cleanup.intervals = [];

    // Clear timeouts
    kazumaExtension.cleanup.timeouts.forEach(id => {
        clearTimeout(id);
        debugLog(`Cleared timeout: ${id}`);
    });
    kazumaExtension.cleanup.timeouts = [];

    // Disconnect mutation observers
    kazumaExtension.cleanup.observers.forEach(observer => {
        observer.disconnect();
        debugLog('Disconnected MutationObserver');
    });
    kazumaExtension.cleanup.observers = [];

    // Cancel any in-progress batch
    cancelBatch();

    // Clear caches
    clearGenerationCache();
    clearAvatarCache();
    clearBatchQueue();

    debugLog('Cleanup complete');
}

/**
 * Register event listener with cleanup tracking
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 */
export function registerEventListener(event, handler) {
    const { eventSource } = kazumaExtension.stAPI;

    if (eventSource && eventSource.on) {
        eventSource.on(event, handler);
        kazumaExtension.cleanup.listeners.push({ event, handler });
        debugLog(`Registered event listener: ${event}`);
    }
}

/**
 * Register interval with cleanup tracking
 * @param {Function} callback - Interval callback
 * @param {number} delay - Delay in milliseconds
 * @returns {number} Interval ID
 */
export function registerInterval(callback, delay) {
    const id = setInterval(callback, delay);
    kazumaExtension.cleanup.intervals.push(id);
    debugLog(`Registered interval: ${id}`);
    return id;
}

/**
 * Register timeout with cleanup tracking
 * @param {Function} callback - Timeout callback
 * @param {number} delay - Delay in milliseconds
 * @returns {number} Timeout ID
 */
export function registerTimeout(callback, delay) {
    const id = setTimeout(callback, delay);
    kazumaExtension.cleanup.timeouts.push(id);
    debugLog(`Registered timeout: ${id}`);
    return id;
}

/**
 * Register mutation observer with cleanup tracking
 * @param {MutationObserver} observer - Mutation observer
 */
export function registerObserver(observer) {
    kazumaExtension.cleanup.observers.push(observer);
    debugLog('Registered MutationObserver');
}

/**
 * Auto-generation handler (called on MESSAGE_RECEIVED event)
 * @param {object} data - Event data
 */
export async function handleAutoGeneration(data) {
    if (!kazumaExtension.enabled) return;

    const settings = getSettings();

    if (!settings.autoGenerate) return;

    autoGenCounter++;

    if (autoGenCounter % settings.autoGenerateFrequency !== 0) {
        debugLog(`Auto-gen counter: ${autoGenCounter} (freq: ${settings.autoGenerateFrequency})`);
        return;
    }

    debugLog('Triggering auto-generation');

    try {
        // Import generation module dynamically to avoid circular dependency
        const { generateImage } = await import('./generation.js');
        const { getContext } = kazumaExtension.stAPI;

        const context = getContext();

        const result = await generateImage({
            workflowName: settings.activeWorkflow,
            settings: settings,
            context: context,
            getRequestHeaders: kazumaExtension.stAPI.getRequestHeaders,
            generateQuietPrompt: kazumaExtension.stAPI.generateQuietPrompt,
            onProgress: () => { }, // Silent auto-gen
            useCache: true
        });

        // Add to last message
        const { appendMediaToMessage } = kazumaExtension.stAPI;
        const lastIndex = context.chat.length - 1;

        if (appendMediaToMessage && lastIndex >= 0) {
            await appendMediaToMessage(result, lastIndex);
            debugLog('Auto-generated image added to chat');

            if (typeof toastr !== 'undefined') {
                toastr.success('Image auto-generated');
            }
        }

    } catch (error) {
        errorLog('Auto-generation failed:', error.message);

        if (typeof toastr !== 'undefined') {
            toastr.error(`Auto-generation failed: ${sanitizeErrorMessage(error.message)}`);
        }
    }
}

/**
 * Reset auto-generation counter
 */
export function resetAutoGenCounter() {
    autoGenCounter = 0;
    debugLog('Auto-gen counter reset');
}

/**
 * Initialize extension
 * @returns {Promise<void>}
 */
export async function initialize() {
    if (kazumaExtension.initialized) {
        debugLog('Extension already initialized');
        return;
    }

    debugLog('Initializing extension...');

    try {
        // Load and validate settings via persistence module
        kazumaExtension.settings = persistence.loadSettings(kazumaExtension.stAPI);

        // Set debug mode
        setDebugMode(kazumaExtension.settings.debugLogging || false);

        // Mark as initialized
        kazumaExtension.initialized = true;

        // Enable if settings say so
        if (kazumaExtension.settings.enabled) {
            kazumaExtension.enabled = true;
        }

        // Register SillyTavern presets
        try {
            registerPresets();
        } catch (presetError) {
            warnLog('Failed to register presets (non-critical):', presetError.message);
        }

        debugLog('Core extension initialized successfully');

    } catch (error) {
        errorLog('Extension initialization failed:', error);
        kazumaExtension.initialized = false;
        throw error;
    }
}

/**
 * Get extension status
 * @returns {object} Status information
 */
export function getStatus() {
    return {
        enabled: kazumaExtension.enabled,
        initialized: kazumaExtension.initialized,
        listenerCount: kazumaExtension.cleanup.listeners.length,
        intervalCount: kazumaExtension.cleanup.intervals.length,
        timeoutCount: kazumaExtension.cleanup.timeouts.length,
        observerCount: kazumaExtension.cleanup.observers.length
    };
}

/**
 * Register extension presets with SillyTavern
 * Called during initialization to register available presets
 */
export function registerPresets() {
    try {
        // Only attempt to register presets if ST preset system is available
        if (typeof registerExtensionPreset !== 'function') {
            debugLog('SillyTavern registerExtensionPreset not available, skipping preset registration');
            return;
        }

        // Register quality presets from constants
        for (const [presetKey, presetData] of Object.entries(QUALITY_PRESETS)) {
            try {
                const presetName = `Image Gen - ${presetData.label}`;
                const presetSettings = createPresetObject(presetData.settings);

                registerExtensionPreset(presetName, presetSettings);
                debugLog(`Registered preset: ${presetName}`);
            } catch (error) {
                warnLog(`Failed to register preset "${presetKey}":`, error.message);
            }
        }

    } catch (error) {
        warnLog('Failed to register presets:', error.message);
        // Non-critical - continue without presets
    }
}

/**
 * Create a SillyTavern preset object from partial settings
 * Only includes portable preset-able fields
 * @param {object} partialSettings - Partial settings to include
 * @returns {object} Presetable settings object
 */
function createPresetObject(partialSettings) {
    const fullSettings = Object.assign({}, DEFAULT_SETTINGS);

    // Allowlist of preset-able fields (excludes runtime-only fields)
    const presetAllowlist = new Set([
        'enabled',
        'compress',
        'debugLogging',
        'comfyUrl',
        'autoGenerate',
        'autoGenerateFrequency',
        'promptStyle',
        'promptPerspective',
        'promptArtStyle',
        'promptExtra',
        'activeWorkflow',
        'steps',
        'cfg',
        'denoise',
        'clipSkip',
        'seed',
        'sampler',
        'scheduler',
        'width',
        'height',
        'model',
        'negativePrompt',
        'lora1',
        'lora1Weight',
        'lora2',
        'lora2Weight',
        'lora3',
        'lora3Weight',
        'lora4',
        'lora4Weight',
        'includeCharAvatar',
        'includePersonaAvatar',
        'qualityPreset'
    ]);

    // Start with defaults, apply overrides
    const presetObj = { ...fullSettings };
    if (partialSettings && typeof partialSettings === 'object') {
        for (const [key, value] of Object.entries(partialSettings)) {
            if (presetAllowlist.has(key)) {
                presetObj[key] = value;
            }
        }
    }

    // Filter to only allowlisted fields
    const filteredPreset = {};
    for (const key of presetAllowlist) {
        if (key in presetObj) {
            filteredPreset[key] = presetObj[key];
        }
    }

    return filteredPreset;
}

/**
 * Apply a preset to current settings
 * @param {object} presetSettings - Preset settings object from SillyTavern
 * @returns {object} Updated settings
 */
export function applyPreset(presetSettings) {
    if (!presetSettings || typeof presetSettings !== 'object') {
        warnLog('Invalid preset settings provided');
        return getSettings();
    }

    try {
        // Get the ST API reference
        const stAPI = kazumaExtension.stAPI;

        if (!stAPI) {
            throw new Error('SillyTavern API not initialized');
        }

        // Get current settings
        const currentSettings = getSettings();

        // Apply preset settings to current settings
        const merged = {
            ...currentSettings,
            ...presetSettings
        };

        // Validate the merged settings
        if (!validateSettings(merged)) {
            throw new Error('Preset validation failed');
        }

        // Update cached settings
        kazumaExtension.settings = merged;

        // Persist via the ST API (save to extension settings)
        stAPI.extension_settings['Image-gen-kazuma-dork'] = merged;

        // Save to persistent storage using SillyTavern's method
        if (typeof stAPI.saveSettingsDebounced === 'function') {
            stAPI.saveSettingsDebounced();
        }

        debugLog('Preset applied successfully');

        if (typeof toastr !== 'undefined') {
            toastr.success('Preset applied');
        }

        return merged;

    } catch (error) {
        errorLog('Failed to apply preset:', error.message);

        if (typeof toastr !== 'undefined') {
            toastr.error(`Failed to apply preset: ${error.message}`);
        }

        throw error;
    }
}
