/**
 * Image Generation Presets Module
 * Manages quality presets and settings templates for SillyTavern integration
 */

/**
 * Quality Presets - defining preset templates for SillyTavern
 */
export const QUALITY_PRESETS = {
    draft: {
        label: 'Draft (Fast)',
        description: 'Fast generation with lower quality for quick previews',
        settings: {
            qualityPreset: 'draft',
            steps: 20,
            cfg: 7,
            denoise: 0.8,
            sampler: 'normal'
        }
    },
    balanced: {
        label: 'Balanced (Default)',
        description: 'Balanced quality and speed for typical use',
        settings: {
            qualityPreset: 'balanced',
            steps: 30,
            cfg: 8.5,
            denoise: 0.85,
            sampler: 'normal'
        }
    },
    quality: {
        label: 'Quality (Slow)',
        description: 'High quality generation with longer processing time',
        settings: {
            qualityPreset: 'quality',
            steps: 40,
            cfg: 10,
            denoise: 0.9,
            sampler: 'dpmpp_2m_karras'
        }
    },
    maximum: {
        label: 'Maximum (Very Slow)',
        description: 'Maximum quality with extended processing time',
        settings: {
            qualityPreset: 'maximum',
            steps: 50,
            cfg: 11,
            denoise: 0.95,
            sampler: 'dpmpp_3m_sde_karras'
        }
    }
};

/**
 * Base Settings Presets
 * Default configuration templates for different workflows
 */
export const BASE_SETTINGS_PRESETS = {
    character: {
        label: 'Character Focus',
        description: 'Optimized for generating character portraits',
        settings: {
            promptStyle: 'formal',
            promptPerspective: 'front_view',
            promptArtStyle: 'detailed illustration',
            width: 512,
            height: 768,
            includeCharAvatar: true,
            includePersonaAvatar: false
        }
    },
    scene: {
        label: 'Scene Generation',
        description: 'Optimized for full scene and background generation',
        settings: {
            promptStyle: 'narrative',
            promptPerspective: 'landscape',
            promptArtStyle: 'painted landscape',
            width: 1024,
            height: 576,
            includeCharAvatar: true,
            includePersonaAvatar: true
        }
    },
    avatar: {
        label: 'Avatar Generation',
        description: 'Optimized for small avatar images',
        settings: {
            promptStyle: 'casual',
            promptPerspective: 'headshot',
            promptArtStyle: 'anime style',
            width: 256,
            height: 256,
            includeCharAvatar: true,
            includePersonaAvatar: false
        }
    }
};

/**
 * Get a quality preset by key
 * @param {string} presetKey - Key of the quality preset
 * @returns {object|null} Preset object or null if not found
 */
export function getQualityPreset(presetKey) {
    return QUALITY_PRESETS[presetKey] || null;
}

/**
 * Get a base settings preset by key
 * @param {string} presetKey - Key of the base settings preset
 * @returns {object|null} Preset object or null if not found
 */
export function getBaseSettingsPreset(presetKey) {
    return BASE_SETTINGS_PRESETS[presetKey] || null;
}

/**
 * List all available quality presets
 * @returns {array} Array of preset info objects
 */
export function listQualityPresets() {
    return Object.entries(QUALITY_PRESETS).map(([key, preset]) => ({
        key,
        label: preset.label,
        description: preset.description
    }));
}

/**
 * List all available base settings presets
 * @returns {array} Array of preset info objects
 */
export function listBaseSettingsPresets() {
    return Object.entries(BASE_SETTINGS_PRESETS).map(([key, preset]) => ({
        key,
        label: preset.label,
        description: preset.description
    }));
}

/**
 * Merge a preset with current settings
 * Preset values override current settings
 * @param {object} currentSettings - Current settings object
 * @param {object} presetSettings - Preset settings to merge
 * @returns {object} Merged settings object
 */
export function mergePreset(currentSettings, presetSettings) {
    if (!currentSettings || !presetSettings) {
        return currentSettings || {};
    }

    return {
        ...currentSettings,
        ...presetSettings
    };
}

/**
 * Validate a preset object structure
 * Checks that preset has required fields
 * @param {object} preset - Preset object to validate
 * @returns {boolean} True if preset is valid
 */
export function validatePreset(preset) {
    if (!preset || typeof preset !== 'object') {
        return false;
    }

    // Minimal validation - preset should have a label and settings
    return 'label' in preset && 'settings' in preset;
}
