/**
 * Core extension module
 * Handles lifecycle, settings management, and cleanup
 */

import { DEFAULT_SETTINGS, QUALITY_PRESETS } from './constants.js';
import { setDebugMode, debugLog, errorLog, warnLog } from './logger.js';
import { validateSettings, sanitizeErrorMessage } from './utils.js';
import { clearGenerationCache } from './cache.js';
import { clearAvatarCache } from './generation.js';
import { cancelBatch, clearBatchQueue } from './batch.js';

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
    cleanup: {
        listeners: [],      // Event listeners to remove
        intervals: [],      // Intervals to clear
        timeouts: [],       // Timeouts to clear
        observers: []       // Mutation observers to disconnect
    },
    // SillyTavern API references (injected during init)
    stAPI: {
        extension_settings: null,
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
 * Get extension settings
 * @returns {object} Extension settings object
 */
export function getSettings() {
    const { extension_settings } = kazumaExtension.stAPI;

    if (!extension_settings || typeof extension_settings !== 'object') {
        throw new Error('SillyTavern API not initialized: extension_settings is unavailable');
    }

    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...DEFAULT_SETTINGS };
        debugLog('Settings initialized with defaults');
    }

    return extension_settings[extensionName];
}

/**
 * Update extension settings
 * @param {object} partial - Partial settings to merge
 */
export function updateSettings(partial) {
    const settings = getSettings();
    const { saveSettingsDebounced } = kazumaExtension.stAPI;

    Object.assign(settings, partial);
    saveSettingsDebounced();

    debugLog('Settings updated:', Object.keys(partial));
}

/**
 * Reset settings to defaults
 */
export function resetSettings() {
    const { extension_settings, saveSettingsDebounced } = kazumaExtension.stAPI;

    extension_settings[extensionName] = { ...DEFAULT_SETTINGS };
    saveSettingsDebounced();

    debugLog('Settings reset to defaults');

    // Show notification if toastr available
    if (typeof toastr !== 'undefined') {
        toastr.info('Settings reset to defaults');
    }
}

/**
 * Export settings to JSON
 * @returns {string} JSON string of settings
 */
export function exportSettings() {
    const settings = getSettings();
    const exportData = JSON.stringify(settings, null, 2);

    try {
        // Save to localStorage as backup
        localStorage.setItem(`${extensionName}_backup`, exportData);

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
    } catch (error) {
        errorLog('Failed to export settings:', error.message);
        if (typeof toastr !== 'undefined') {
            toastr.error('Failed to export settings');
        }
    }

    return exportData;
}

/**
 * Import settings from various sources
 * @param {string|object} source - 'localStorage', 'clipboard', JSON string, or object
 * @returns {Promise<object>} Imported settings
 */
export async function importSettings(source) {
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

        // Validate and clamp values
        const validated = validateSettings(importedData);

        // Merge with current settings
        const current = getSettings();
        Object.assign(current, validated);

        const { saveSettingsDebounced } = kazumaExtension.stAPI;
        saveSettingsDebounced();

        debugLog('Settings imported and validated');

        if (typeof toastr !== 'undefined') {
            toastr.success('Settings imported successfully');
        }

        return current;

    } catch (error) {
        errorLog('Failed to import settings:', error.message);
        if (typeof toastr !== 'undefined') {
            toastr.error(`Import failed: ${sanitizeErrorMessage(error.message)}`);
        }
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

    const { saveSettingsDebounced } = kazumaExtension.stAPI;
    saveSettingsDebounced();

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

        const { saveSettingsDebounced } = kazumaExtension.stAPI;
        saveSettingsDebounced();

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
        // Load settings
        const settings = getSettings();

        // Set debug mode
        setDebugMode(settings.debugLogging || false);

        // Mark as initialized
        kazumaExtension.initialized = true;

        // Enable if settings say so
        if (settings.enabled) {
            kazumaExtension.enabled = true;
        }

        debugLog('Core extension initialized');

    } catch (error) {
        errorLog('Extension initialization failed:', error);
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
