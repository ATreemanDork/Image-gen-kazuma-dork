/* eslint-disable no-undef */
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, generateQuietPrompt, saveChat, reloadCurrentChat, eventSource, event_types, addOneMessage, getRequestHeaders, appendMediaToMessage } from "../../../../script.js";
import { saveBase64AsFile } from "../../../utils.js";
import { humanizedDateTime } from "../../../RossAscends-mods.js";
import { Popup, POPUP_TYPE } from "../../../popup.js";

const extensionName = "Image-gen-kazuma";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// --- PHASE 1: RELIABILITY UTILITIES ---
/**
 * Wraps fetch with a timeout to prevent hanging requests.
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options (method, headers, body, etc.)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000 = 30s)
 * @returns {Promise<Response>} The fetch response
 * @throws {Error} Timeout error or network error
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            const timeoutSec = (timeoutMs / 1000).toFixed(1);
            throw new Error(`Request timeout after ${timeoutSec}s - ComfyUI server may be unresponsive. Check http://${new URL(url).host} and network connection.`);
        }
        throw error;
    }
}

/**
 * Categorizes fetch/ComfyUI errors into actionable error messages.
 * Detects CORS, permission, timeout, network, and ComfyUI-specific errors.
 * @param {Error} error - The error object
 * @param {object} context - Context object { response, url, method }
 * @returns {string} Detailed error message for user display
 */
function getDetailedErrorMessage(error, context = {}) {
    const { response, url = '', method = 'POST' } = context;
    const errorMsg = error?.message || String(error);

    // Timeout errors
    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
        return `⏱️ Request timed out. ComfyUI server at ${url} did not respond. Check: 1) Server is running, 2) URL is correct, 3) Network connection. If problem persists, increase timeout in settings.`;
    }

    // CORS/Network errors
    if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        return `🔗 Network/CORS error. ComfyUI server at ${url} is unreachable or blocking requests. Check: 1) URL is correct (include http://), 2) Server firewall/CORS settings, 3) Your internet connection.`;
    }

    // Permission/Auth errors (403, 401)
    if (response?.status === 403) {
        return `🔐 Permission denied (403). ComfyUI server rejected request. Check: 1) API key/credentials, 2) Server authentication settings, 3) User permissions.`;
    }
    if (response?.status === 401) {
        return `🔐 Unauthorized (401). ComfyUI server requires authentication. Check: 1) API key in settings, 2) Token expiration, 3) Server auth configuration.`;
    }

    // Server errors (5xx)
    if (response?.status >= 500) {
        return `⚠️ ComfyUI server error (${response.status}). Server encountered an internal error. Check: 1) Server logs, 2) ComfyUI version compatibility, 3) Available disk space.`;
    }

    // Bad request (400, 422)
    if (response?.status === 400 || response?.status === 422) {
        return `❌ Invalid request (${response.status}). Check: 1) Workflow JSON is valid, 2) All required fields present, 3) Model/LoRA names exist on server.`;
    }

    // Not found (404)
    if (response?.status === 404) {
        return `🔍 Not found (404). Check: 1) ComfyUI server is accessible at ${url}, 2) Workflow file exists, 3) API endpoint is correct.`;
    }

    // Generic fallback
    return `❌ Generation failed: ${errorMsg}. Check server health and try again.`;
}

// --- PHASE 2: VALIDATION & SAFETY UTILITIES ---
/**
 * Sanitizes workflow filenames to prevent path traversal attacks.
 * Only allows alphanumeric, dash, underscore, and .json extension.
 * @param {string} filename - The filename to sanitize
 * @returns {string} Sanitized filename, or throws error if invalid
 */
function sanitizeWorkflowFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        throw new Error('Workflow filename must be a non-empty string');
    }

    // Remove leading/trailing whitespace
    const cleaned = filename.trim();

    // Ensure .json extension
    const withExt = cleaned.toLowerCase().endsWith('.json') ? cleaned : `${cleaned}.json`;

    // Whitelist: alphanumeric, dash, underscore, dot for extension
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(withExt)) {
        throw new Error(`Invalid filename: "${withExt}". Only alphanumeric, dash, underscore, and .json allowed. No slashes or special characters.`);
    }

    // Prevent path traversal attempts
    if (withExt.includes('..') || withExt.includes('/') || withExt.includes('\\')) {
        throw new Error('Filename contains invalid path characters. Use only: a-z, 0-9, dash, underscore, .json');
    }

    return withExt;
}

/**
 * Validates and clamps numeric values to expected ranges.
 * @param {any} value - Value to validate
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value  
 * @param {number} defaultValue - Value to use if input is invalid
 * @returns {number} Validated and clamped value
 */
function validateAndClampNumber(value, min, max, defaultValue = min) {
    const num = parseFloat(value);

    if (isNaN(num)) {
        console.warn(`[${extensionName}] Invalid number: "${value}", using default ${defaultValue}`);
        return defaultValue;
    }

    if (num < min) {
        console.warn(`[${extensionName}] Value ${num} below minimum ${min}, clamping to ${min}`);
        return min;
    }

    if (num > max) {
        console.warn(`[${extensionName}] Value ${num} exceeds maximum ${max}, clamping to ${max}`);
        return max;
    }

    return num;
}

/**
 * Validates workflow JSON structure before sending to ComfyUI.
 * Checks for required properties and node structure.
 * @param {object} workflow - The workflow object to validate
 * @returns {object} The validated workflow
 * @throws {Error} If workflow is invalid
 */
function validateWorkflowJSON(workflow) {
    if (!workflow || typeof workflow !== 'object') {
        throw new Error('Workflow must be a valid JSON object');
    }

    // Check if it has at least one node
    const nodeIds = Object.keys(workflow);
    if (nodeIds.length === 0) {
        throw new Error('Workflow is empty - must contain at least one node');
    }

    // Validate node structure
    let hasValidNode = false;
    for (const nodeId of nodeIds) {
        const node = workflow[nodeId];

        if (!node || typeof node !== 'object') {
            throw new Error(`Node "${nodeId}" is not a valid object`);
        }

        // Each node should have a class_type at minimum
        if (typeof node.class_type === 'string') {
            hasValidNode = true;
        }
    }

    if (!hasValidNode) {
        throw new Error('Workflow contains no valid nodes with class_type property');
    }

    return workflow;
}

/**
 * Validates that required placeholder values are not empty.
 * @param {object} values - Key-value object with placeholder values
 * @returns {Array} Array of missing required values, empty if all present
 */
function validateRequiredPlaceholders(values) {
    const required = ['positivePrompt'];
    const missing = [];

    required.forEach(key => {
        if (!values[key] || (typeof values[key] === 'string' && values[key].trim() === '')) {
            missing.push(key);
        }
    });

    return missing;
}

// --- PHASE 4: AVATAR INJECTION UTILITIES ---
// Session-scoped avatar cache (NOT persisted to settings)
const _sessionAvatarCache = {};

/**
 * Converts an avatar image URL to base64 JPEG format.
 * Uses Canvas API and caches result in session memory to avoid re-encoding.
 * @param {string} avatarUrl - Full URL to avatar image
 * @param {string} filename - Identifier for cache (usually avatar filename)
 * @returns {Promise<string>} Base64-encoded JPEG data (data URL format)
 * @throws {Error} If image fails to load or conversion fails
 */
async function getAvatarAsBase64(avatarUrl, filename) {
    // Return cached version if available (session-scoped only)
    if (_sessionAvatarCache[filename]) {
        console.log(`[${extensionName}] Using cached avatar for ${filename}`);
        return _sessionAvatarCache[filename];
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous"; // Handle CORS

        img.onload = () => {
            try {
                // Create canvas matching image dimensions (native size)
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('Could not get canvas 2D context');
                }

                // Draw image on canvas
                ctx.drawImage(img, 0, 0);

                // Convert to JPEG base64 (quality 0.85)
                const base64Data = canvas.toDataURL('image/jpeg', 0.85);

                // Cache in session memory
                _sessionAvatarCache[filename] = base64Data;

                console.log(`[${extensionName}] Avatar converted to JPEG (${img.width}x${img.height}), cached as ${filename}`);
                resolve(base64Data);
            } catch (error) {
                reject(new Error(`Failed to convert avatar to JPEG: ${error.message}`));
            }
        };

        img.onerror = () => {
            reject(new Error(`Failed to load avatar image from ${avatarUrl}`));
        };

        img.src = avatarUrl;
    });
}

/**
 * Injects character and persona avatars into workflow based on settings.
 * Uses SillyTavern context API to fetch avatar URLs and converts to base64 JPEG.
 * @param {object} workflow - The workflow to inject avatars into
 * @param {boolean} includeCharacter - Whether to inject character avatar
 * @param {boolean} includePersona - Whether to inject persona avatar
 * @returns {Promise<object>} Workflow with avatar placeholders injected as base64
 */
async function injectAvatarPlaceholders(workflow, includeCharacter = false, includePersona = false) {
    if (!includeCharacter && !includePersona) {
        return workflow; // No avatars requested
    }

    const context = getContext();
    const avatarInjections = {};

    // Get character avatar if requested
    if (includeCharacter && context.characterId) {
        try {
            const charName = context.characters[context.characterId]?.name || `char_${context.characterId}`;
            const charAvatarUrl = context.getThumbnailUrl(context.characterId, context.characters[context.characterId]?.avatar);

            if (charAvatarUrl) {
                const base64Avatar = await getAvatarAsBase64(charAvatarUrl, `char_${context.characterId}`);
                avatarInjections.char_avatar = base64Avatar;
                console.log(`[${extensionName}] Injected character avatar for ${charName}`);
            } else {
                console.warn(`[${extensionName}] No avatar URL found for character ${charName}`);
            }
        } catch (error) {
            console.warn(`[${extensionName}] Failed to inject character avatar: ${error.message}`);
            // Graceful fallback: inject empty string (won't break workflow if optional)
            avatarInjections.char_avatar = "";
        }
    }

    // Get persona avatar if requested
    if (includePersona && window.power_user?.user_avatar) {
        try {
            const personaUrl = window.power_user.user_avatar;
            const base64Avatar = await getAvatarAsBase64(personaUrl, 'persona_avatar');
            avatarInjections.persona_avatar = base64Avatar;
            console.log(`[${extensionName}] Injected persona avatar`);
        } catch (error) {
            console.warn(`[${extensionName}] Failed to inject persona avatar: ${error.message}`);
            avatarInjections.persona_avatar = "";
        }
    }

    // Inject avatars into workflow similar to other parameters
    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];

                // Support both *token* and %token% formats
                if (val === "*char_avatar*" || val === "%char_avatar%") {
                    node.inputs[key] = avatarInjections.char_avatar || "";
                }
                if (val === "*persona_avatar*" || val === "%persona_avatar%") {
                    node.inputs[key] = avatarInjections.persona_avatar || "";
                }
            }
        }
    }

    return workflow;
}

// ============================================================
// PHASE 3: CONFIGURATION & QUALITY PRESETS
// ============================================================

const QUALITY_PRESETS = {
    low: {
        label: "Low (Fast, Lower Quality)",
        settings: { steps: 12, cfg: 5.0, denoise: 0.4, clipSkip: 2 }
    },
    medium: {
        label: "Medium (Balanced)",
        settings: { steps: 20, cfg: 7.0, denoise: 0.5, clipSkip: 1 }
    },
    high: {
        label: "High (Better Quality)",
        settings: { steps: 30, cfg: 8.0, denoise: 0.6, clipSkip: 1 }
    },
    ultra: {
        label: "Ultra (Maximum Quality)",
        settings: { steps: 50, cfg: 9.0, denoise: 0.75, clipSkip: 1 }
    }
};

/**
 * Apply a quality preset and update extension settings
 * @param {string} presetName - Preset to apply (low/medium/high/ultra)
 */
function applyQualityPreset(presetName) {
    if (!QUALITY_PRESETS[presetName]) {
        console.warn(`[${extensionName}] Unknown quality preset: ${presetName}`);
        return false;
    }

    const preset = QUALITY_PRESETS[presetName];
    const settings = getSettings();

    // Apply preset settings
    Object.assign(settings, preset.settings);
    settings.qualityPreset = presetName;

    // Update UI
    $("#kazuma_quality_preset").val(presetName);
    updateSliderInput('kazuma_steps', 'kazuma_steps_val', preset.settings.steps);
    updateSliderInput('kazuma_cfg', 'kazuma_cfg_val', preset.settings.cfg);
    updateSliderInput('kazuma_denoise', 'kazuma_denoise_val', preset.settings.denoise);
    updateSliderInput('kazuma_clip', 'kazuma_clip_val', preset.settings.clipSkip);

    saveSettingsDebounced();
    toastr.success(`Quality preset "${preset.label}" applied!`);
    return true;
}

/**
 * Save current prompt template with custom prompt settings
 * @param {string} templateName - Name for the template
 */
function savePromptTemplate(templateName) {
    if (!templateName || templateName.trim() === "") {
        toastr.error("Please enter a template name");
        return false;
    }

    const settings = getSettings();
    const template = {
        name: templateName.trim(),
        style: settings.promptStyle,
        perspective: settings.promptPerspective,
        artStyle: settings.promptArtStyle,
        extra: settings.promptExtra,
        timestamp: Date.now()
    };

    // Check if template exists
    const existingIdx = settings.savedPromptTemplates.findIndex(t => t.name === template.name);
    if (existingIdx >= 0) {
        // Update existing
        settings.savedPromptTemplates[existingIdx] = template;
        toastr.info(`Template "${templateName}" updated!`);
    } else {
        // Add new
        settings.savedPromptTemplates.push(template);
        toastr.success(`Template "${templateName}" saved!`);
    }

    saveSettingsDebounced();
    updatePromptTemplateDropdown();
    return true;
}

/**
 * Load a saved prompt template
 * @param {string} templateName - Name of template to load
 */
function loadPromptTemplate(templateName) {
    const settings = getSettings();
    const template = settings.savedPromptTemplates.find(t => t.name === templateName);

    if (!template) {
        toastr.error(`Template "${templateName}" not found`);
        return false;
    }

    // Apply template settings
    settings.promptStyle = template.style;
    settings.promptPerspective = template.perspective;
    settings.promptArtStyle = template.artStyle;
    settings.promptExtra = template.extra;
    settings.customPromptTemplate = templateName;

    // Update UI
    $("#kazuma_prompt_style").val(template.style);
    $("#kazuma_prompt_persp").val(template.perspective);
    $("#kazuma_prompt_art_style").val(template.artStyle);
    $("#kazuma_prompt_extra").val(template.extra);

    saveSettingsDebounced();
    toastr.success(`Template "${templateName}" loaded!`);
    return true;
}

/**
 * Delete a prompt template
 * @param {string} templateName - Name of template to delete
 */
function deletePromptTemplate(templateName) {
    const settings = getSettings();
    const idx = settings.savedPromptTemplates.findIndex(t => t.name === templateName);

    if (idx < 0) {
        toastr.error(`Template "${templateName}" not found`);
        return false;
    }

    settings.savedPromptTemplates.splice(idx, 1);
    if (settings.customPromptTemplate === templateName) {
        settings.customPromptTemplate = "";
    }

    saveSettingsDebounced();
    updatePromptTemplateDropdown();
    toastr.success(`Template "${templateName}" deleted!`);
    return true;
}

/**
 * Update the prompt template dropdown UI
 */
function updatePromptTemplateDropdown() {
    const settings = getSettings();
    const dropdown = $("#kazuma_prompt_template");

    dropdown.empty().append('<option value="">-- No Template --</option>');
    settings.savedPromptTemplates.forEach(template => {
        dropdown.append(`<option value="${template.name}">${template.name}</option>`);
    });

    dropdown.val(settings.customPromptTemplate || "");
}

/**
 * Export all settings to localStorage
 */
function exportSettings() {
    try {
        const settings = getSettings();
        const exportData = {
            version: "1.0.0",
            timestamp: Date.now(),
            settings: settings
        };
        const dataStr = JSON.stringify(exportData, null, 2);

        // Save to localStorage with unique key
        const storageKey = `kazuma_export_${Date.now()}`;
        localStorage.setItem(storageKey, dataStr);

        // Show export key to user
        const message = `Settings exported to localStorage with key: ${storageKey}`;

        // Copy to clipboard if available
        if (navigator.clipboard) {
            navigator.clipboard.writeText(dataStr).then(() => {
                toastr.success("Settings exported and copied to clipboard!");
            }).catch(() => {
                toastr.success(message);
            });
        } else {
            toastr.success(message);
        }

        // Also create download link as fallback
        const dataBlob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `kazuma-settings-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error(`[${extensionName}] Export failed:`, error);
        toastr.error(`Export failed: ${error.message}`);
    }
}

/**
 * Import settings from JSON (file or localStorage)
 * @param {File|string} source - JSON file or JSON string
 */
async function importSettings(source) {
    try {
        let text;
        let importData;

        // Handle file input
        if (source instanceof File) {
            if (!source.name.endsWith(".json")) {
                toastr.error("Please select a valid JSON file");
                return false;
            }
            text = await source.text();
        }
        // Handle direct string input (from localStorage or clipboard)
        else if (typeof source === "string") {
            text = source;
        } else {
            toastr.error("Invalid import source");
            return false;
        }

        importData = JSON.parse(text);

        // Handle both new format (with version/timestamp) and legacy format
        const importedSettings = importData.settings || importData;

        // Validate and merge settings
        const currentSettings = getSettings();
        let importedCount = 0;

        for (const key in importedSettings) {
            // Skip fields we never want to overwrite
            if (["connectionProfile", "lastGenerationTime", "totalGenerations"].includes(key)) continue;

            // Only import valid settings keys that exist in defaultSettings
            if (Object.hasOwn(defaultSettings, key)) {
                currentSettings[key] = importedSettings[key];
                importedCount++;
            }
        }

        saveSettingsDebounced();
        await loadSettings(); // Refresh UI

        toastr.success(`Settings imported successfully! (${importedCount} settings restored)`);
        return true;
    } catch (error) {
        console.error(`[${extensionName}] Import failed:`, error);
        toastr.error(`Import failed: ${error.message}`);
        return false;
    }
}

/**
 * Import settings from localStorage by key
 */
function importFromLocalStorage() {
    const storageKey = prompt("Enter localStorage key (e.g., kazuma_export_1234567890):");
    if (!storageKey) return;

    try {
        const data = localStorage.getItem(storageKey);
        if (!data) {
            toastr.error(`No data found for key: ${storageKey}`);
            return;
        }

        importSettings(data);
    } catch (error) {
        console.error(`[${extensionName}] localStorage import failed:`, error);
        toastr.error(`Import failed: ${error.message}`);
    }
}

/**
 * Import settings from clipboard
 */
async function importFromClipboard() {
    try {
        if (!navigator.clipboard) {
            toastr.warning("Clipboard API not available");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (!text) {
            toastr.error("Clipboard is empty");
            return;
        }

        await importSettings(text);
    } catch (error) {
        console.error(`[${extensionName}] Clipboard import failed:`, error);
        toastr.error(`Import failed: ${error.message}`);
    }
}

// ============================================================
// PHASE 5: BATCH GENERATION SYSTEM
// ============================================================

// Batch queue state
let batchQueue = {
    isProcessing: false,
    queue: [],
    currentIndex: 0,
    results: [
        // { index, imageUrl, prompt, timestamp, success, error }
    ]
};

/**
 * Initialize a batch generation queue
 * @param {number} count - Number of images to generate
 * @param {Object} basePromptData - Base prompt parameters
 */
function initializeBatchQueue(count, basePromptData = {}) {
    if (count < 1 || count > 100) {
        toastr.error("Batch count must be between 1 and 100");
        return false;
    }

    batchQueue.queue = [];
    batchQueue.currentIndex = 0;
    batchQueue.results = [];

    // Create batch entries with varied seeds
    for (let i = 0; i < count; i++) {
        const params = { ...basePromptData };
        // Vary seed for each batch item
        if (params.customSeed === -1 || params.customSeed === "-1") {
            params.batchIndex = i; // Use ComfyUI's natural variation
        } else {
            params.customSeed = params.customSeed + i; // Or increment seed
        }

        batchQueue.queue.push(params);
    }

    return true;
}

/**
 * Process batch queue sequentially
 * @param {Function} onProgress - Callback(current, total) for progress updates
 * @param {Function} onComplete - Callback(results) when batch completes
 * @returns {Promise<Array>} Results array with generation outcomes
 */
async function processBatchQueue(onProgress, onComplete) {
    if (batchQueue.isProcessing) {
        toastr.warning("Batch already processing");
        return;
    }

    if (batchQueue.queue.length === 0) {
        toastr.error("No items in batch queue");
        return;
    }

    batchQueue.isProcessing = true;
    batchQueue.results = [];
    const s = extension_settings[extensionName];
    const originalSeed = s.customSeed;

    for (let i = 0; i < batchQueue.queue.length; i++) {
        batchQueue.currentIndex = i;

        if (onProgress) {
            onProgress(i + 1, batchQueue.queue.length);
        }

        try {
            // Prepare seed for this batch item
            if (originalSeed === -1 || originalSeed === "-1") {
                s.customSeed = Math.floor(Math.random() * 1000000000);
            } else {
                s.customSeed = parseInt(originalSeed) + i;
            }

            // Generate prompt for last message
            const context = getContext();
            if (!context.chat || context.chat.length === 0) {
                throw new Error("No chat history available");
            }

            const lastMessage = context.chat[context.chat.length - 1].mes;
            const style = s.promptStyle || "standard";
            const persp = s.promptPerspective || "scene";
            const artStyle = s.promptArtStyle || "realistic";
            const extra = s.promptExtra ? `, ${s.promptExtra}` : "";

            // Create style instruction (same as in onGeneratePrompt)
            let styleInst = "Use a list of detailed keywords/descriptors.";
            if (style === "illustrious") styleInst = "Use Booru-style tags (e.g., 1girl, solo, blue hair). Focus on anime aesthetics.";
            else if (style === "sdxl") styleInst = "Use natural language sentences. Focus on photorealism and detailed textures.";

            let perspInst = "Describe the entire environment and atmosphere.";
            if (persp === "pov") perspInst = "Describe the scene from a First Person (POV) perspective, looking at the character.";
            else if (persp === "character") perspInst = "Focus intensely on the character's appearance and expression, ignoring background details.";

            // Art style instructions (abbreviated from onGeneratePrompt)
            let artStyleInst = "High-quality detailed illustration.";
            const artStyleMap = {
                "realistic": "Photorealistic, high-fidelity, lifelike portraits and landscapes with fine details and natural lighting.",
                "anime": "2D/3D anime art style, pastel illustrations, expressive eyes, stylized character features, manga-influenced compositions.",
                "3d": "3D rendered quality, CGI-style, computer-generated imagery resembling Pixar or animated movies, glossy surfaces, smooth shading.",
                "fantasy": "Mystical and epic fantasy art, magical elements, fantastical landscapes, dragons, enchanted forests, otherworldly aesthetics.",
                "painterly": "Artistic painting styles including oil painting, watercolors, acrylic, sketches, impressionism, or hand-drawn illustrations.",
                "cinematic": "Dramatic movie-still quality, professional cinematography, theatrical lighting, epic composition, Hollywood blockbuster aesthetic.",
                "pixel": "Pixel art, low-resolution retro gaming style, 8-bit or 16-bit aesthetic, chunky pixels, limited color palette.",
                "lineart": "Black and white line drawings, coloring book style, simple clean lines, minimalist illustration, sketch-like appearance.",
                "scifi": "Science fiction aesthetic, futuristic technology, cyberpunk cityscapes, neon colors, sci-fi environments, space settings.",
                "cartoon": "Western cartoon and comic book style, playful and exaggerated forms, bold outlines, vibrant colors, comic panel compositions."
            };
            if (artStyleMap[artStyle]) artStyleInst = artStyleMap[artStyle];

            const instruction = `
            Task: Write an image generation prompt for the following scene.
            Scene: "${lastMessage}"
            Format: ${styleInst}
            Camera Perspective: ${perspInst}
            Art Style: ${artStyleInst}
            Additional Instructions: ${extra}
            Output ONLY the prompt text.
            `;

            // Generate prompt silently
            const generatedPrompt = await generateQuietPrompt(instruction, false);

            // Generate image with ComfyUI
            showKazumaProgress(`Batch ${i + 1}/${batchQueue.queue.length}: Generating...`);
            const batchResult = await new Promise((resolve, reject) => {
                // Wrap generateWithComfy to capture results
                const originalProgress = hideKazumaProgress;
                generateWithComfy(generatedPrompt, null)
                    .then(() => {
                        resolve({
                            index: i,
                            prompt: generatedPrompt,
                            timestamp: Date.now(),
                            success: true
                        });
                    })
                    .catch(err => {
                        reject(err);
                    });
            });

            batchQueue.results.push(batchResult);

            // Delay between generations
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            batchQueue.results.push({
                index: i,
                timestamp: Date.now(),
                success: false,
                error: error.message || String(error)
            });

            console.error(`[${extensionName}] Batch item ${i} failed:`, error);
        }
    }

    // Restore original seed
    s.customSeed = originalSeed;
    batchQueue.isProcessing = false;

    hideKazumaProgress();

    if (onComplete) {
        onComplete(batchQueue.results);
    }

    return batchQueue.results;
}

/**
 * Get current batch queue status
 */
function getBatchQueueStatus() {
    return {
        isProcessing: batchQueue.isProcessing,
        currentIndex: batchQueue.currentIndex,
        totalItems: batchQueue.queue.length,
        completedItems: batchQueue.results.length,
        successCount: batchQueue.results.filter(r => r.success).length,
        failureCount: batchQueue.results.filter(r => !r.success).length
    };
}

/**
 * Cancel batch processing
 */
function cancelBatchQueue() {
    batchQueue.isProcessing = false;
    batchQueue.queue = [];
    batchQueue.results = [];
    batchQueue.currentIndex = 0;
    toastr.info("Batch generation cancelled");
}

// ============================================================
// PHASE 6: RESPONSE CACHING SYSTEM
// ============================================================

// Session-based response cache
let responseCache = {
    entries: new Map(),
    // entries key format: 'prompt|style|perspective|artStyle|width|height|seed|model'
    stats: {
        hits: 0,
        misses: 0,
        evictions: 0
    }
};

/**
 * Generate cache key from generation parameters
 * @param {Object} params - Generation parameters
 */
function getCacheKey(params) {
    return JSON.stringify({
        input: params.input,
        ninput: params.ninput,
        style: params.style,
        perspective: params.perspective,
        artStyle: params.artStyle,
        width: params.width,
        height: params.height,
        seed: params.seed,
        model: params.model,
        sampler: params.sampler,
        steps: params.steps,
        cfg: params.cfg
    });
}

/**
 * Cache a generation response
 * @param {string|Object} keyOrParams - Cache key or params object
 * @param {Object} response - Response data to cache
 * @param {number} ttl - Time-to-live in milliseconds
 */
function cacheResponse(keyOrParams, response, ttl = null) {
    const settings = extension_settings[extensionName];
    if (!settings.enableCaching) return;

    ttl = ttl || settings.cacheTTL || 3600000;

    const key = typeof keyOrParams === "string" ? keyOrParams : getCacheKey(keyOrParams);

    responseCache.entries.set(key, {
        response: response,
        timestamp: Date.now(),
        ttl: ttl,
        expiresAt: Date.now() + ttl
    });

    // Cleanup old entries if cache grows too large
    if (responseCache.entries.size > 100) {
        cleanupCache();
    }
}

/**
 * Retrieve cached response if available and not expired
 * @param {string|Object} keyOrParams - Cache key or params object
 */
function getCachedResponse(keyOrParams) {
    const settings = extension_settings[extensionName];
    if (!settings.enableCaching) return null;

    const key = typeof keyOrParams === "string" ? keyOrParams : getCacheKey(keyOrParams);
    const entry = responseCache.entries.get(key);

    if (!entry) {
        responseCache.stats.misses++;
        return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
        responseCache.entries.delete(key);
        responseCache.stats.evictions++;
        responseCache.stats.misses++;
        return null;
    }

    responseCache.stats.hits++;
    return entry.response;
}

/**
 * Cleanup expired cache entries
 */
function cleanupCache() {
    const now = Date.now();
    const keysToDelete = [];

    responseCache.entries.forEach((entry, key) => {
        if (now > entry.expiresAt) {
            keysToDelete.push(key);
            responseCache.stats.evictions++;
        }
    });

    keysToDelete.forEach(key => responseCache.entries.delete(key));
}

/**
 * Clear all cached responses
 */
function clearResponseCache() {
    responseCache.entries.clear();
    responseCache.stats = { hits: 0, misses: 0, evictions: 0 };
    toastr.info("Response cache cleared");
}

/**
 * Get cache statistics
 */
function getCacheStats() {
    cleanupCache(); // Update stats first
    return {
        ...responseCache.stats,
        totalEntries: responseCache.entries.size,
        hitRate: responseCache.stats.hits + responseCache.stats.misses > 0
            ? (responseCache.stats.hits / (responseCache.stats.hits + responseCache.stats.misses) * 100).toFixed(2) + "%"
            : "N/A"
    };
}

// --- UPDATED CONSTANTS (With Dscriptions) ---
const KAZUMA_PLACEHOLDERS = [
    { key: '"*input*"', desc: "Positive Prompt (Text)" },
    { key: '"%input%"', desc: "Positive Prompt (Text) - Alt Format" },
    { key: '"*ninput*"', desc: "Negative Prompt (Text)" },
    { key: '"%ninput%"', desc: "Negative Prompt (Text) - Alt Format" },
    { key: '"*seed*"', desc: "Seed (Integer)" },
    { key: '"*steps*"', desc: "Sampling Steps (Integer)" },
    { key: '"*cfg*"', desc: "CFG Scale (Float)" },
    { key: '"*denoise*"', desc: "Denoise Strength (Float)" },
    { key: '"*clip_skip*"', desc: "CLIP Skip (Integer)" },
    { key: '"*model*"', desc: "Checkpoint Name" },
    { key: '"*sampler*"', desc: "Sampler Name" },
    { key: '"*width*"', desc: "Image Width (px)" },
    { key: '"*height*"', desc: "Image Height (px)" },
    { key: '"*batch_size*"', desc: "Batch Size (Integer)" },
    { key: '"*max_size*"', desc: "Maximum Size (Integer)" },
    { key: '"*bbox_crop_factor*"', desc: "BBox Crop Factor (Float)" },
    { key: '"*lora*"', desc: "LoRA 1 Filename" },
    { key: '"*lorawt*"', desc: "LoRA 1 Weight (Float)" },
    { key: '"*lora2*"', desc: "LoRA 2 Filename" },
    { key: '"*lorawt2*"', desc: "LoRA 2 Weight (Float)" },
    { key: '"*lora3*"', desc: "LoRA 3 Filename" },
    { key: '"*lorawt3*"', desc: "LoRA 3 Weight (Float)" },
    { key: '"*lora4*"', desc: "LoRA 4 Filename" },
    { key: '"*lorawt4*"', desc: "LoRA 4 Weight (Float)" },
    { key: '"*char_avatar*"', desc: "Character Avatar (Base64 JPEG)" },
    { key: '"%char_avatar%"', desc: "Character Avatar (Base64 JPEG) - Alt Format" },
    { key: '"*persona_avatar*"', desc: "Persona Avatar (Base64 JPEG)" },
    { key: '"%persona_avatar%"', desc: "Persona Avatar (Base64 JPEG) - Alt Format" }
];

const RESOLUTIONS = [
    { label: "1024 x 1024 (SDXL 1:1)", w: 1024, h: 1024 },
    { label: "1152 x 896 (SDXL Landscape)", w: 1152, h: 896 },
    { label: "896 x 1152 (SDXL Portrait)", w: 896, h: 1152 },
    { label: "1216 x 832 (SDXL Landscape)", w: 1216, h: 832 },
    { label: "832 x 1216 (SDXL Portrait)", w: 832, h: 1216 },
    { label: "1344 x 768 (SDXL Landscape)", w: 1344, h: 768 },
    { label: "768 x 1344 (SDXL Portrait)", w: 768, h: 1344 },
    { label: "512 x 512 (SD 1.5 1:1)", w: 512, h: 512 },
    { label: "768 x 512 (SD 1.5 Landscape)", w: 768, h: 512 },
    { label: "512 x 768 (SD 1.5 Portrait)", w: 512, h: 768 },
];

const defaultWorkflowData = {
    "3": { "inputs": { "seed": "seed", "steps": 20, "cfg": 7, "sampler_name": "sampler", "scheduler": "normal", "denoise": 1, "model": ["35", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
    "4": { "inputs": { "ckpt_name": "model" }, "class_type": "CheckpointLoaderSimple" },
    "5": { "inputs": { "width": "width", "height": "height", "batch_size": 1 }, "class_type": "EmptyLatentImage" },
    "6": { "inputs": { "text": "input", "clip": ["35", 1] }, "class_type": "CLIPTextEncode" },
    "7": { "inputs": { "text": "ninput", "clip": ["35", 1] }, "class_type": "CLIPTextEncode" },
    "8": { "inputs": { "samples": ["33", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
    "14": { "inputs": { "images": ["8", 0] }, "class_type": "PreviewImage" },
    "33": { "inputs": { "seed": "seed", "steps": 20, "cfg": 7, "sampler_name": "sampler", "scheduler": "normal", "denoise": 0.5, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["34", 0] }, "class_type": "KSampler" },
    "34": { "inputs": { "upscale_method": "nearest-exact", "scale_by": 1.2, "samples": ["3", 0] }, "class_type": "LatentUpscaleBy" },
    "35": { "inputs": { "lora_name": "lora", "strength_model": "lorawt", "strength_clip": "lorawt", "model": ["4", 0], "clip": ["4", 1] }, "class_type": "LoraLoader" }
};

// SillyTavern Best Practice: Use Object.freeze() for immutable defaults
const defaultSettings = Object.freeze({
    enabled: true,
    debugPrompt: false,
    comfyUrl: "http://127.0.0.1:8188",
    connectionProfile: "",
    currentWorkflowName: "", // Server manages this now
    selectedModel: "",
    selectedLora: "",
    selectedLora2: "",
    selectedLora3: "",
    selectedLora4: "",
    selectedLoraWt: 1.0,
    selectedLoraWt2: 1.0,
    selectedLoraWt3: 1.0,
    selectedLoraWt4: 1.0,
    imgWidth: 1024,
    imgHeight: 1024,
    autoGenEnabled: false,
    autoGenFreq: 1,
    customNegative: "bad quality, blurry, worst quality, low quality",
    customSeed: -1,
    selectedSampler: "euler",
    compressImages: true,
    steps: 20,
    cfg: 7.0,
    denoise: 0.5,
    clipSkip: 1,
    profileStrategy: "current",
    promptStyle: "standard",
    promptPerspective: "scene",
    promptArtStyle: "realistic",      // Art style for prompt generation
    promptExtra: "",
    connectionProfile: "",
    avatarIncludeCharacter: false,    // Phase 4: Include character avatar in generation
    avatarIncludePersona: false,      // Phase 4: Include persona avatar in generation
    // Phase 3: Quality presets and templates
    qualityPreset: "medium",          // Current quality preset (low/medium/high/ultra/custom)
    savedPromptTemplates: [],         // Array of {name, style, perspective, artStyle, extra}
    customPromptTemplate: "",         // Currently selected custom template name
    // Phase 5: Batch generation settings
    batchMode: false,                 // Enable batch generation
    batchCount: 3,                    // Number of images to generate
    // Phase 6: Response caching
    enableCaching: true,              // Cache generation responses
    cacheTTL: 3600000,                // Cache time-to-live in milliseconds (1 hour)
    savedWorkflowStates: {},
    // Performance metrics
    lastGenerationTime: 0,            // Track generation time in milliseconds
    averageGenerationTime: 0,         // Rolling average
    totalGenerations: 0               // Total generation count
});

/**
 * Get or initialize settings following SillyTavern best practices
 * Uses structuredClone and ensures all default keys exist after updates
 */
function getSettings() {
    // Initialize settings if they don't exist
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist (helpful after updates)
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extension_settings[extensionName], key)) {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }

    return extension_settings[extensionName];
}

async function loadSettings() {
    // Use getSettings() for proper initialization
    const settings = getSettings();

    $("#kazuma_enable").prop("checked", settings.enabled);
    $("#kazuma_debug").prop("checked", settings.debugPrompt);
    $("#kazuma_url").val(settings.comfyUrl);
    $("#kazuma_width").val(settings.imgWidth);
    $("#kazuma_height").val(settings.imgHeight);
    $("#kazuma_auto_enable").prop("checked", settings.autoGenEnabled);
    $("#kazuma_auto_freq").val(settings.autoGenFreq);

    $("#kazuma_prompt_style").val(settings.promptStyle || "standard");
    $("#kazuma_prompt_persp").val(settings.promptPerspective || "scene");
    $("#kazuma_prompt_art_style").val(settings.promptArtStyle || "realistic");
    $("#kazuma_prompt_extra").val(settings.promptExtra || "");

    $("#kazuma_lora_wt").val(settings.selectedLoraWt);
    $("#kazuma_lora_wt_display").text(settings.selectedLoraWt);
    $("#kazuma_lora_wt_2").val(settings.selectedLoraWt2);
    $("#kazuma_lora_wt_display_2").text(settings.selectedLoraWt2);
    $("#kazuma_lora_wt_3").val(settings.selectedLoraWt3);
    $("#kazuma_lora_wt_display_3").text(settings.selectedLoraWt3);
    $("#kazuma_lora_wt_4").val(settings.selectedLoraWt4);
    $("#kazuma_lora_wt_display_4").text(settings.selectedLoraWt4);

    $("#kazuma_negative").val(settings.customNegative);
    $("#kazuma_seed").val(settings.customSeed);
    $("#kazuma_compress").prop("checked", settings.compressImages);

    // Phase 4: Load avatar settings
    $("#kazuma_avatar_character").prop("checked", settings.avatarIncludeCharacter || false);
    $("#kazuma_avatar_persona").prop("checked", settings.avatarIncludePersona || false);

    $("#kazuma_profile_strategy").val(settings.profileStrategy || "current");
    toggleProfileVisibility();

    updateSliderInput('kazuma_steps', 'kazuma_steps_val', settings.steps);
    updateSliderInput('kazuma_cfg', 'kazuma_cfg_val', settings.cfg);
    updateSliderInput('kazuma_denoise', 'kazuma_denoise_val', settings.denoise);
    updateSliderInput('kazuma_clip', 'kazuma_clip_val', settings.clipSkip);

    // Phase 3: Load quality preset and template settings
    $("#kazuma_quality_preset").val(settings.qualityPreset || "medium");
    updatePromptTemplateDropdown();

    // Phase 5: Load batch settings
    $("#kazuma_batch_mode").prop("checked", settings.batchMode || false);
    $("#kazuma_batch_count").val(settings.batchCount || 3);
    toggleBatchUI();

    // Phase 6: Load cache settings
    $("#kazuma_enable_cache").prop("checked", settings.enableCaching !== false);
    $("#kazuma_cache_ttl").val((settings.cacheTTL || 3600000) / 60000); // Convert to minutes for display
    updatePerformanceStats();

    populateResolutions();
    populateProfiles();
    populateWorkflows();
    await fetchComfyLists();
}

function toggleProfileVisibility() {
    const settings = getSettings();

    // Always show the builder now!
    $("#kazuma_prompt_builder").show();

    // Only toggle the preset selector
    if (settings.profileStrategy === "specific") {
        $("#kazuma_profile").show();
    } else {
        $("#kazuma_profile").hide();
    }
}

function updateSliderInput(sliderId, numberId, value) {
    $(`#${sliderId}`).val(value);
    $(`#${numberId}`).val(value);
}

function toggleBatchUI() {
    const settings = getSettings();
    if (settings.batchMode) {
        $("#kazuma_batch_count_section").show();
    } else {
        $("#kazuma_batch_count_section").hide();
    }
}

function updatePerformanceStats() {
    const settings = getSettings();

    // Update last generation time
    if (settings.lastGenerationTime > 0) {
        const lastTimeSeconds = (settings.lastGenerationTime / 1000).toFixed(1);
        $("#kazuma_last_gen_time").text(`${lastTimeSeconds}s`);
    } else {
        $("#kazuma_last_gen_time").text("N/A");
    }

    // Update average generation time
    if (settings.averageGenerationTime > 0) {
        const avgTimeSeconds = (settings.averageGenerationTime / 1000).toFixed(1);
        $("#kazuma_avg_gen_time").text(`${avgTimeSeconds}s`);
    } else {
        $("#kazuma_avg_gen_time").text("N/A");
    }

    // Update total count
    $("#kazuma_total_gens").text(settings.totalGenerations || 0);
}

function populateResolutions() {
    const sel = $("#kazuma_resolution_list");
    sel.empty().append('<option value="">-- Select Preset --</option>');
    RESOLUTIONS.forEach((r, idx) => {
        sel.append(`<option value="${idx}">${r.label}</option>`);
    });
}

// --- WORKFLOW MANAGER ---
async function populateWorkflows() {
    const sel = $("#kazuma_workflow_list");
    sel.empty();
    try {
        const response = await fetchWithTimeout('/api/sd/comfy/workflows', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: extension_settings[extensionName].comfyUrl }),
        }, 30000);

        if (response.ok) {
            const workflows = await response.json();
            workflows.forEach(w => {
                sel.append(`<option value="${w}">${w}</option>`);
            });

            if (extension_settings[extensionName].currentWorkflowName) {
                if (workflows.includes(extension_settings[extensionName].currentWorkflowName)) {
                    sel.val(extension_settings[extensionName].currentWorkflowName);
                } else if (workflows.length > 0) {
                    sel.val(workflows[0]);
                    extension_settings[extensionName].currentWorkflowName = workflows[0];
                    saveSettingsDebounced();
                }
            } else if (workflows.length > 0) {
                sel.val(workflows[0]);
                extension_settings[extensionName].currentWorkflowName = workflows[0];
                saveSettingsDebounced();
            }
        } else {
            sel.append(`<option disabled>Failed to load (HTTP ${response.status})</option>`);
        }
    } catch (e) {
        const errorMsg = getDetailedErrorMessage(e, { url: '/api/sd/comfy/workflows', method: 'POST' });
        console.warn(`[${extensionName}] Failed to populate workflows: ${errorMsg}`);
        sel.append('<option disabled>Failed to load</option>');
    }
}

async function onComfyNewWorkflowClick() {
    let name = await prompt("New workflow file name (e.g. 'my_flux.json'):");
    if (!name) return;

    try {
        // Sanitize filename to prevent path traversal and injection attacks
        name = sanitizeWorkflowFilename(name);

        const res = await fetchWithTimeout('/api/sd/comfy/save-workflow', {
            method: 'POST', headers: getRequestHeaders(),
            body: JSON.stringify({ file_name: name, workflow: '{}' })
        }, 30000);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to create workflow (${res.status}): ${errorText}`);
        }

        toastr.success("Workflow created!");
        await populateWorkflows();
        $("#kazuma_workflow_list").val(name).trigger('change');
        setTimeout(onComfyOpenWorkflowEditorClick, 500);
    } catch (e) {
        const msg = e.message || String(e);
        toastr.error(msg, "Image Gen Kazuma - Error");
    }
}

async function onComfyDeleteWorkflowClick() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return;
    if (!confirm(`Delete ${name}?`)) return;

    try {
        // Validate filename before deletion (defense in depth)
        sanitizeWorkflowFilename(name);

        const res = await fetchWithTimeout('/api/sd/comfy/delete-workflow', {
            method: 'POST', headers: getRequestHeaders(),
            body: JSON.stringify({ file_name: name })
        }, 30000);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to delete workflow (${res.status}): ${errorText}`);
        }

        toastr.success("Deleted.");
        await populateWorkflows();
    } catch (e) {
        const msg = e.message || String(e);
        toastr.error(msg, "Image Gen Kazuma - Error");
    }
}

/* --- WORKFLOW STUDIO (Live Capture Fix) --- */
async function onComfyOpenWorkflowEditorClick() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return toastr.warning("No workflow selected");

    try {
        // Validate filename before loading (defense in depth)
        sanitizeWorkflowFilename(name);

        // 1. Load Data
        let loadedContent = "{}";
        try {
            const res = await fetchWithTimeout('/api/sd/comfy/workflow', {
                method: 'POST', headers: getRequestHeaders(),
                body: JSON.stringify({ file_name: name })
            }, 30000);

            if (res.ok) {
                const rawBody = await res.json();
                let jsonObj = rawBody;
                if (typeof rawBody === 'string') {
                    try { jsonObj = JSON.parse(rawBody); } catch (e) { }
                }
                loadedContent = JSON.stringify(jsonObj, null, 4);
            } else {
                throw new Error(`Failed to load file (HTTP ${res.status})`);
            }
        } catch (e) {
            const msg = e.message || String(e);
            toastr.error(`Could not load file: ${msg}. Starting with empty workflow.`);
        }

        // 2. Variable to hold the text in memory (Critical for saving)
        let currentJsonText = loadedContent;

        // --- UI BUILDER ---
        const $container = $(`
        <div style="display: flex; flex-direction: column; width: 100%; gap: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--smart-border-color); padding-bottom:10px;">
                <h3 style="margin:0;">${name}</h3>
                <div style="display:flex; gap:5px;">
                    <button class="menu_button wf-format" title="Beautify JSON"><i class="fa-solid fa-align-left"></i> Format</button>
                    <button class="menu_button wf-import" title="Upload .json file"><i class="fa-solid fa-upload"></i> Import</button>
                    <button class="menu_button wf-export" title="Download .json file"><i class="fa-solid fa-download"></i> Export</button>
                    <input type="file" class="wf-file-input" accept=".json" style="display:none;" />
                </div>
            </div>

            <div style="display: flex; gap: 15px;">
                <textarea class="text_pole wf-textarea" spellcheck="false"
                    style="flex: 1; min-height: 600px; height: 600px; font-family: 'Consolas', 'Monaco', monospace; white-space: pre; resize: none; font-size: 13px; padding: 10px; line-height: 1.4;"></textarea>

                <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--smart-border-color); padding-left: 10px; max-height: 600px;">
                    <h4 style="margin: 0 0 10px 0; opacity:0.8;">Placeholders</h4>
                    <div class="wf-list" style="overflow-y: auto; flex: 1; padding-right: 5px;"></div>
                </div>
            </div>
            <small style="opacity:0.5;">Tip: Ensure your JSON is valid before saving.</small>
        </div>
    `);

        // --- LOGIC ---
        const $textarea = $container.find('.wf-textarea');
        const $list = $container.find('.wf-list');
        const $fileInput = $container.find('.wf-file-input');

        // Initialize UI
        $textarea.val(currentJsonText);

        // Sidebar Generator
        KAZUMA_PLACEHOLDERS.forEach(item => {
            const $itemDiv = $('<div></div>')
                .css({
                    'padding': '8px 6px', 'margin-bottom': '6px', 'background-color': 'rgba(0,0,0,0.1)',
                    'border-radius': '4px', 'font-family': 'monospace', 'font-size': '12px',
                    'border': '1px solid transparent', 'transition': 'all 0.2s', 'cursor': 'text'
                });
            const $keySpan = $('<span></span>').text(item.key).css({ 'font-weight': 'bold', 'color': 'var(--smart-text-color)' });
            const $descSpan = $('<div></div>').text(item.desc).css({ 'font-size': '11px', 'opacity': '0.7', 'margin-top': '2px', 'font-family': 'sans-serif' });
            $itemDiv.append($keySpan).append($descSpan);
            $list.append($itemDiv);
        });

        // Highlighting & LIVE UPDATE Logic
        const updateState = () => {
            // 1. Capture text into memory variable
            currentJsonText = $textarea.val();

            // 2. Run Highlighting logic (Visuals)
            $list.children().each(function () {
                const cleanKey = $(this).find('span').first().text().replace(/"/g, '');
                if (currentJsonText.includes(cleanKey)) $(this).css({ 'border': '1px solid #4caf50', 'background-color': 'rgba(76, 175, 80, 0.1)' });
                else $(this).css({ 'border': '1px solid transparent', 'background-color': 'rgba(0,0,0,0.1)' });
            });
        };

        // Bind Input Listener to update variable immediately
        $textarea.on('input', updateState);
        setTimeout(updateState, 100);

        // Toolbar Actions
        $container.find('.wf-format').on('click', () => {
            try {
                const formatted = JSON.stringify(JSON.parse($textarea.val()), null, 4);
                $textarea.val(formatted);
                updateState(); // Update variable
                toastr.success("Formatted");
            } catch (e) { toastr.warning("Invalid JSON"); }
        });

        $container.find('.wf-import').on('click', () => $fileInput.click());
        $fileInput.on('change', (e) => {
            if (!e.target.files[0]) return;
            const r = new FileReader(); r.onload = (ev) => {
                $textarea.val(ev.target.result);
                updateState(); // Update variable
                toastr.success("Imported");
            };
            r.readAsText(e.target.files[0]); $fileInput.val('');
        });

        $container.find('.wf-export').on('click', () => {
            try { JSON.parse(currentJsonText); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([currentJsonText], { type: "application/json" })); a.download = name; a.click(); } catch (e) { toastr.warning("Invalid content"); }
        });

        // Validating Closure
        const onClosing = () => {
            try {
                JSON.parse(currentJsonText); // Validate the variable, not the UI
                return true;
            } catch (e) {
                toastr.error("Invalid JSON. Cannot save.");
                return false;
            }
        };

        const popup = new Popup($container, POPUP_TYPE.CONFIRM, '', { okButton: 'Save Changes', cancelButton: 'Cancel', wide: true, large: true, onClosing: onClosing });
        const confirmed = await popup.show();

        // SAVING
        if (confirmed) {
            try {
                console.log(`[${extensionName}] Saving workflow: ${name}`);
                // Minify
                const minified = JSON.stringify(JSON.parse(currentJsonText));
                const res = await fetchWithTimeout('/api/sd/comfy/save-workflow', {
                    method: 'POST', headers: getRequestHeaders(),
                    body: JSON.stringify({ file_name: name, workflow: minified })
                }, 30000);

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`Failed to save (${res.status}): ${errorText}`);
                }
                toastr.success("Workflow Saved!");
            } catch (e) {
                toastr.error("Save Failed: " + e.message);
            }
        }
    } catch (error) {
        const msg = error.message || String(error);
        console.error(`[${extensionName}] Workflow editor error:`, msg);
        toastr.error(`Workflow editor error: ${msg}`);
    }
}



// --- FETCH LISTS ---
async function fetchComfyLists() {
    const comfyUrl = extension_settings[extensionName].comfyUrl;
    const modelSel = $("#kazuma_model_list");
    const samplerSel = $("#kazuma_sampler_list");
    const loraSelectors = [$("#kazuma_lora_list"), $("#kazuma_lora_list_2"), $("#kazuma_lora_list_3"), $("#kazuma_lora_list_4")];

    try {
        // Fetch models with timeout
        const modelRes = await fetchWithTimeout('/api/sd/comfy/models', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: comfyUrl })
        }, 30000);

        if (modelRes.ok) {
            const models = await modelRes.json();
            modelSel.empty().append('<option value="">-- Select Model --</option>');
            models.forEach(m => {
                let val = (typeof m === 'object' && m !== null) ? m.value : m;
                let text = (typeof m === 'object' && m !== null && m.text) ? m.text : val;
                modelSel.append(`<option value="${val}">${text}</option>`);
            });
            if (extension_settings[extensionName].selectedModel) modelSel.val(extension_settings[extensionName].selectedModel);
        } else {
            console.warn(`[${extensionName}] Failed to fetch models (HTTP ${modelRes.status})`);
        }

        // Fetch samplers with timeout
        const samplerRes = await fetchWithTimeout('/api/sd/comfy/samplers', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: comfyUrl })
        }, 30000);

        if (samplerRes.ok) {
            const samplers = await samplerRes.json();
            samplerSel.empty();
            samplers.forEach(s => samplerSel.append(`<option value="${s}">${s}</option>`));
            if (extension_settings[extensionName].selectedSampler) samplerSel.val(extension_settings[extensionName].selectedSampler);
        } else {
            console.warn(`[${extensionName}] Failed to fetch samplers (HTTP ${samplerRes.status})`);
        }

        // Fetch LoRAs from ComfyUI directly with timeout
        const loraRes = await fetchWithTimeout(`${comfyUrl}/object_info/LoraLoader`, {}, 30000);

        if (loraRes.ok) {
            const json = await loraRes.json();
            const files = json['LoraLoader'].input.required.lora_name[0];
            loraSelectors.forEach((sel, i) => {
                const k = i === 0 ? "selectedLora" : `selectedLora${i + 1}`;
                const v = extension_settings[extensionName][k];
                sel.empty().append('<option value="">-- No LoRA --</option>');
                files.forEach(f => sel.append(`<option value="${f}">${f}</option>`));
                if (v) sel.val(v);
            });
        } else {
            console.warn(`[${extensionName}] Failed to fetch LoRAs (HTTP ${loraRes.status})`);
        }
    } catch (e) {
        const errorMsg = getDetailedErrorMessage(e, { url: extension_settings[extensionName].comfyUrl, method: 'POST' });
        console.warn(`[${extensionName}] Failed to fetch lists: ${errorMsg}`);
    }
}

async function onTestConnection() {
    const url = extension_settings[extensionName].comfyUrl;
    try {
        const result = await fetchWithTimeout('/api/sd/comfy/ping', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: url })
        }, 30000);

        if (result.ok) {
            toastr.success("ComfyUI API connected!", "Image Gen Kazuma");
            await fetchComfyLists();
        } else {
            const detailedMsg = getDetailedErrorMessage(
                new Error(`Ping failed with status ${result.status}`),
                { response: result, url: url, method: 'POST' }
            );
            throw new Error(detailedMsg);
        }
    } catch (error) {
        const msg = error.message || String(error);
        toastr.error(msg, "Image Gen Kazuma - Connection Error");
    }
}

/* --- UPDATED GENERATION LOGIC --- */
async function onGeneratePrompt() {
    if (!extension_settings[extensionName].enabled) return;
    const context = getContext();
    if (!context.chat || context.chat.length === 0) return toastr.warning("No chat history.");

    // Phase 5: Check if batch mode is enabled
    const s = extension_settings[extensionName];
    if (s.batchMode && s.batchCount && s.batchCount > 1) {
        toastr.info(`Starting batch generation (${s.batchCount} images)...`);
        initializeBatchQueue(s.batchCount);
        showKazumaProgress(`Preparing batch queue...`);

        processBatchQueue(
            (current, total) => {
                showKazumaProgress(`Batch Progress: ${current}/${total}`);
            },
            (results) => {
                const successCount = results.filter(r => r.success).length;
                const failCount = results.filter(r => !r.success).length;
                hideKazumaProgress();
                toastr.success(`Batch complete! ${successCount} succeeded, ${failCount} failed.`);
            }
        );
        return;
    }

    const strategy = extension_settings[extensionName].profileStrategy || "current";
    const requestProfile = extension_settings[extensionName].connectionProfile;
    const targetDropdown = $("#settings_preset_openai");
    const originalProfile = targetDropdown.val();
    let didSwitch = false;

    if (strategy === "specific" && requestProfile && requestProfile !== originalProfile && requestProfile !== "") {
        toastr.info(`Switching presets...`);
        targetDropdown.val(requestProfile).trigger("change");
        await new Promise(r => setTimeout(r, 1000));
        didSwitch = true;
    }

    // [START PROGRESS]
    showKazumaProgress("Generating Prompt...");

    try {
        toastr.info("Visualizing...", "Image Gen Kazuma");
        const lastMessage = context.chat[context.chat.length - 1].mes;
        const s = extension_settings[extensionName];

        const style = s.promptStyle || "standard";
        const persp = s.promptPerspective || "scene";
        const artStyle = s.promptArtStyle || "realistic";
        const extra = s.promptExtra ? `, ${s.promptExtra}` : "";

        let styleInst = "", perspInst = "", artStyleInst = "";

        // Format constraint based on model/prompt style
        if (style === "illustrious") styleInst = "Use Booru-style tags (e.g., 1girl, solo, blue hair). Focus on anime aesthetics.";
        else if (style === "sdxl") styleInst = "Use natural language sentences. Focus on photorealism and detailed textures.";
        else styleInst = "Use a list of detailed keywords/descriptors.";

        // Perspective constraint
        if (persp === "pov") perspInst = "Describe the scene from a First Person (POV) perspective, looking at the character.";
        else if (persp === "character") perspInst = "Focus intensely on the character's appearance and expression, ignoring background details.";
        else perspInst = "Describe the entire environment and atmosphere.";

        // Art style constraint
        if (artStyle === "realistic") artStyleInst = "Photorealistic, high-fidelity, lifelike portraits and landscapes with fine details and natural lighting.";
        else if (artStyle === "anime") artStyleInst = "2D/3D anime art style, pastel illustrations, expressive eyes, stylized character features, manga-influenced compositions.";
        else if (artStyle === "3d") artStyleInst = "3D rendered quality, CGI-style, computer-generated imagery resembling Pixar or animated movies, glossy surfaces, smooth shading.";
        else if (artStyle === "fantasy") artStyleInst = "Mystical and epic fantasy art, magical elements, fantastical landscapes, dragons, enchanted forests, otherworldly aesthetics.";
        else if (artStyle === "painterly") artStyleInst = "Artistic painting styles including oil painting, watercolors, acrylic, sketches, impressionism, or hand-drawn illustrations.";
        else if (artStyle === "cinematic") artStyleInst = "Dramatic movie-still quality, professional cinematography, theatrical lighting, epic composition, Hollywood blockbuster aesthetic.";
        else if (artStyle === "pixel") artStyleInst = "Pixel art, low-resolution retro gaming style, 8-bit or 16-bit aesthetic, chunky pixels, limited color palette.";
        else if (artStyle === "lineart") artStyleInst = "Black and white line drawings, coloring book style, simple clean lines, minimalist illustration, sketch-like appearance.";
        else if (artStyle === "scifi") artStyleInst = "Science fiction aesthetic, futuristic technology, cyberpunk cityscapes, neon colors, sci-fi environments, space settings.";
        else if (artStyle === "cartoon") artStyleInst = "Western cartoon and comic book style, playful and exaggerated forms, bold outlines, vibrant colors, comic panel compositions.";
        else artStyleInst = "High-quality detailed illustration.";

        const instruction = `
            Task: Write an image generation prompt for the following scene.
            Scene: "${lastMessage}"
            Format: ${styleInst}
            Camera Perspective: ${perspInst}
            Art Style: ${artStyleInst}
            Additional Instructions: ${extra}
            Output ONLY the prompt text.
            `;

        let generatedText = await generateQuietPrompt(instruction, true);

        if (didSwitch) {
            targetDropdown.val(originalProfile).trigger("change");
            await new Promise(r => setTimeout(r, 500));
        }

        if (s.debugPrompt) {
            // Hide progress while user is confirming
            hideKazumaProgress();

            const $content = $(`
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <p><b>Review generated prompt:</b></p>
                    <textarea class="text_pole" rows="6" style="width:100%; resize:vertical; font-family:monospace;">${generatedText}</textarea>
                </div>
            `);
            let currentText = generatedText;
            $content.find("textarea").on("input", function () { currentText = $(this).val(); });
            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Diagnostic Mode", { okButton: "Send", cancelButton: "Stop" });
            const confirmed = await popup.show();

            if (!confirmed) {
                toastr.info("Generation stopped by user.");
                return;
            }
            generatedText = currentText;
            // Show progress again
            showKazumaProgress("Sending to ComfyUI...");
        }

        // Update progress text
        showKazumaProgress("Sending to ComfyUI...");
        await generateWithComfy(generatedText, null);

    } catch (err) {
        // [HIDE PROGRESS ON ERROR]
        hideKazumaProgress();
        if (didSwitch) targetDropdown.val(originalProfile).trigger("change");
        console.error(err);
        toastr.error("Generation failed. Check console.");
    }
}

async function generateWithComfy(positivePrompt, target = null) {
    const url = extension_settings[extensionName].comfyUrl;
    const currentName = extension_settings[extensionName].currentWorkflowName;
    const s = extension_settings[extensionName];

    // Performance tracking: Start timer
    const generationStartTime = Date.now();

    // Phase 6: Check cache for identical generation parameters
    const cacheParams = {
        input: positivePrompt,
        style: s.promptStyle,
        perspective: s.promptPerspective,
        artStyle: s.promptArtStyle,
        width: s.imgWidth,
        height: s.imgHeight,
        model: s.selectedModel,
        sampler: s.selectedSampler,
        steps: s.steps,
        cfg: s.cfg
    };
    const cachedResponse = getCachedResponse(cacheParams);
    if (cachedResponse) {
        toastr.success("Using cached response!", "Image Gen Kazuma");
        hideKazumaProgress();
        // In a full implementation, you would display the cached image here
        return cachedResponse;
    }

    // Load from server
    let workflowRaw;
    try {
        const res = await fetchWithTimeout('/api/sd/comfy/workflow', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ file_name: currentName })
        }, 30000);

        if (!res.ok) {
            const detailedMsg = getDetailedErrorMessage(
                new Error(`Failed with status ${res.status}`),
                { response: res, url: '/api/sd/comfy/workflow', method: 'POST' }
            );
            throw new Error(detailedMsg);
        }
        workflowRaw = await res.json();
    } catch (e) {
        toastr.error(`Could not load workflow '${currentName}': ${e.message}`);
        hideKazumaProgress();
        return;
    }

    let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;

    let finalSeed = parseInt(extension_settings[extensionName].customSeed);
    if (finalSeed === -1 || isNaN(finalSeed)) {
        finalSeed = Math.floor(Math.random() * 1000000000);
    }

    workflow = injectParamsIntoWorkflow(workflow, positivePrompt, finalSeed);

    try {
        // Phase 4: Inject character/persona avatars as base64 JPEG if enabled
        if (s.avatarIncludeCharacter || s.avatarIncludePersona) {
            showKazumaProgress("Processing avatars...");
            workflow = await injectAvatarPlaceholders(workflow, s.avatarIncludeCharacter, s.avatarIncludePersona);
        }

        // Validate workflow structure before sending to ComfyUI (Phase 2 Safety)
        validateWorkflowJSON(workflow);

        toastr.info("Sending to ComfyUI...", "Image Gen Kazuma");
        showKazumaProgress("Submitting to ComfyUI...");

        const res = await fetchWithTimeout(`${url}/prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: workflow })
        }, 30000);

        if (!res.ok) {
            const detailedMsg = getDetailedErrorMessage(
                new Error(`Failed with status ${res.status}`),
                { response: res, url: `${url}/prompt`, method: 'POST' }
            );
            throw new Error(detailedMsg);
        }

        const data = await res.json();
        await waitForGeneration(url, data.prompt_id, positivePrompt, target);

        // Performance tracking: Calculate generation time
        const generationTime = Date.now() - generationStartTime;
        s.lastGenerationTime = generationTime;
        s.totalGenerations++;

        // Update rolling average
        if (s.totalGenerations === 1) {
            s.averageGenerationTime = generationTime;
        } else {
            s.averageGenerationTime = Math.round(
                (s.averageGenerationTime * (s.totalGenerations - 1) + generationTime) / s.totalGenerations
            );
        }

        saveSettingsDebounced();

        // Update performance stats UI
        updatePerformanceStats();

        // Show generation time
        const timeSeconds = (generationTime / 1000).toFixed(1);
        console.log(`[${extensionName}] Generation completed in ${timeSeconds}s`);
        toastr.info(`Generated in ${timeSeconds}s`, "Performance");
    } catch (e) {
        const errorMsg = e.message || String(e);
        toastr.error(errorMsg, "Image Gen Kazuma - Error");
        hideKazumaProgress();
    }
}

function injectParamsIntoWorkflow(workflow, promptText, finalSeed) {
    const s = extension_settings[extensionName];
    let seedInjected = false;

    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];

                // Support both *token* and %token% formats (Phase 4)
                if (val === "*input*" || val === "%input%") node.inputs[key] = promptText;
                if (val === "*ninput*" || val === "%ninput%") node.inputs[key] = s.customNegative || "";
                if (val === "*seed*") { node.inputs[key] = finalSeed; seedInjected = true; }
                if (val === "*sampler*") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "*model*") node.inputs[key] = s.selectedModel || "v1-5-pruned.ckpt";

                // Use validated/clamped numeric values (Phase 2 Validation)
                if (val === "*steps*") node.inputs[key] = validateAndClampNumber(s.steps, 1, 150, 20);
                if (val === "*cfg*") node.inputs[key] = validateAndClampNumber(s.cfg, 0, 30, 7.0);
                if (val === "*denoise*") node.inputs[key] = validateAndClampNumber(s.denoise, 0, 1, 1.0);
                if (val === "*clip_skip*") node.inputs[key] = -Math.abs(validateAndClampNumber(s.clipSkip, 1, 12, 1));

                if (val === "*lora*") node.inputs[key] = s.selectedLora || "None";
                if (val === "*lora2*") node.inputs[key] = s.selectedLora2 || "None";
                if (val === "*lora3*") node.inputs[key] = s.selectedLora3 || "None";
                if (val === "*lora4*") node.inputs[key] = s.selectedLora4 || "None";
                if (val === "*lorawt*") node.inputs[key] = validateAndClampNumber(s.selectedLoraWt, 0, 2, 1.0);
                if (val === "*lorawt2*") node.inputs[key] = validateAndClampNumber(s.selectedLoraWt2, 0, 2, 1.0);
                if (val === "*lorawt3*") node.inputs[key] = validateAndClampNumber(s.selectedLoraWt3, 0, 2, 1.0);
                if (val === "*lorawt4*") node.inputs[key] = validateAndClampNumber(s.selectedLoraWt4, 0, 2, 1.0);

                if (val === "*width*") node.inputs[key] = validateAndClampNumber(s.imgWidth, 256, 2048, 512);
                if (val === "*height*") node.inputs[key] = validateAndClampNumber(s.imgHeight, 256, 2048, 512);

                // Phase 4: New variables from workflow analysis
                if (val === "*batch_size*") node.inputs[key] = validateAndClampNumber(1, 1, 16, 1); // Typically 1 for single generation
                if (val === "*max_size*") node.inputs[key] = validateAndClampNumber(2048, 256, 4096, 2048);
                if (val === "*bbox_crop_factor*") node.inputs[key] = validateAndClampNumber(1.0, 0.5, 2.0, 1.0);
            }
            if (!seedInjected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') {
                node.inputs.seed = finalSeed;
            }
        }
    }
    return workflow;
}

async function onImageSwiped(data) {
    if (!extension_settings[extensionName].enabled) return;
    const { message, direction, element } = data;
    const context = getContext();
    const settings = context.powerUserSettings || window.power_user;

    if (direction !== "right") return;
    if (settings && settings.image_overswipe !== "generate") return;
    if (message.name !== "Image Gen Kazuma") return;

    const media = message.extra?.media || [];
    const idx = message.extra?.media_index || 0;

    if (idx < media.length - 1) return;

    const mediaObj = media[idx];
    if (!mediaObj || !mediaObj.title) return;

    const prompt = mediaObj.title;
    toastr.info("New variation...", "Image Gen Kazuma");
    await generateWithComfy(prompt, { message: message, element: $(element) });
}

async function waitForGeneration(baseUrl, promptId, positivePrompt, target) {
    const MAX_ATTEMPTS = 300; // 5 minutes @ 1000ms intervals
    const CHECK_INTERVAL = 1000; // 1 second
    let attempts = 0;

    try {
        showKazumaProgress("Rendering Image...");

        // Poll for completion with timeout protection
        while (attempts < MAX_ATTEMPTS) {
            attempts++;

            try {
                const h = await fetchWithTimeout(`${baseUrl}/history/${promptId}`, {}, 10000);

                if (!h.ok) {
                    // Handle HTTP errors during polling
                    if (h.status === 404) {
                        throw new Error(`Prompt ID ${promptId} not found on server. Check ComfyUI is running.`);
                    }
                    throw new Error(`History query failed with status ${h.status}`);
                }

                const historyData = await h.json();
                if (historyData[promptId]) {
                    // Job completed! Process output
                    const outputs = historyData[promptId].outputs;
                    let finalImage = null;

                    for (const nodeId in outputs) {
                        const nodeOutput = outputs[nodeId];
                        if (nodeOutput.images && nodeOutput.images.length > 0) {
                            finalImage = nodeOutput.images[0];
                            break;
                        }
                    }

                    if (finalImage) {
                        showKazumaProgress("Downloading...");
                        const imgUrl = `${baseUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;
                        await insertImageToChat(imgUrl, positivePrompt, target);
                    }

                    // Success - exit loop
                    break;
                }

                // Job not done yet, wait before retry
                await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));

            } catch (pollingError) {
                // Network/timeout error during polling retry
                if (pollingError.message.includes('timeout')) {
                    // Timeout during individual request - continue polling
                    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
                    continue;
                }
                // Other errors (404, parse) should be thrown
                throw pollingError;
            }
        }

        // Check if we hit max attempts (timeout)
        if (attempts >= MAX_ATTEMPTS) {
            const maxWaitMin = (MAX_ATTEMPTS * CHECK_INTERVAL / 60000).toFixed(1);
            throw new Error(`Generation timeout after ${maxWaitMin} minutes. Check ComfyUI server logs.`);
        }

    } catch (error) {
        const detailedMsg = getDetailedErrorMessage(error, { url: baseUrl, method: 'GET' });
        toastr.error(detailedMsg, "Image Gen Kazuma - Error");
    } finally {
        // GUARANTEE cleanup: always hide progress overlay
        hideKazumaProgress();
    }
}

function blobToBase64(blob) { return new Promise((resolve) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.readAsDataURL(blob); }); }

function compressImage(base64Str, quality = 0.9) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(base64Str);
    });
}

// --- SAVE TO SERVER ---
async function insertImageToChat(imgUrl, promptText, target = null) {
    try {
        toastr.info("Downloading image...", "Image Gen Kazuma");
        const response = await fetchWithTimeout(imgUrl, {}, 30000);

        if (!response.ok) {
            throw new Error(`Failed to download image (HTTP ${response.status})`);
        }

        const blob = await response.blob();
        let base64FullURL = await blobToBase64(blob);

        let format = "png";
        if (extension_settings[extensionName].compressImages) {
            base64FullURL = await compressImage(base64FullURL, 0.9);
            format = "jpeg";
        }

        const base64Raw = base64FullURL.split(',')[1];
        const context = getContext();
        let characterName = "User";
        if (context.groupId) {
            characterName = context.groups.find(x => x.id === context.groupId)?.id;
        } else if (context.characterId) {
            characterName = context.characters[context.characterId]?.name;
        }
        if (!characterName) characterName = "User";

        const filename = `${characterName}_${humanizedDateTime()}`;
        const savedPath = await saveBase64AsFile(base64Raw, characterName, filename, format);

        const mediaAttachment = {
            url: savedPath,
            type: "image",
            source: "generated",
            title: promptText,
            generation_type: "free",
        };

        if (target && target.message) {
            if (!target.message.extra) target.message.extra = {};
            if (!target.message.extra.media) target.message.extra.media = [];
            target.message.extra.media_display = "gallery";
            target.message.extra.media.push(mediaAttachment);
            target.message.extra.media_index = target.message.extra.media.length - 1;
            if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
            await saveChat();
            toastr.success("Gallery updated!");
        } else {
            const newMessage = {
                name: "Image Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(),
                mes: "", extra: { media: [mediaAttachment], media_display: "gallery", media_index: 0, inline_image: false }, force_avatar: "img/five.png"
            };
            context.chat.push(newMessage);
            await saveChat();
            if (typeof addOneMessage === "function") addOneMessage(newMessage);
            else await reloadCurrentChat();
            toastr.success("Image inserted!");
        }

    } catch (err) {
        const errorMsg = getDetailedErrorMessage(err, { url: imgUrl, method: 'GET' });
        console.error(`[${extensionName}] Image insertion error:`, err);
        toastr.error(errorMsg, "Image Gen Kazuma - Error");
    }
}

// --- INIT ---
jQuery(async () => {
    try {
        // 1. INJECT PROGRESS BAR HTML (New Code Here)
        if ($("#kazuma_progress_overlay").length === 0) {
            $("body").append(`
                <div id="kazuma_progress_overlay">
                    <div style="flex:1">
                        <span id="kazuma_progress_text">Generating Image...</span>
                        <div class="kazuma-bar-container">
                            <div class="kazuma-bar-fill"></div>
                        </div>
                    </div>
                </div>
            `);
        }

        // 2. Load Settings & Bind Events
        await $.get(`${extensionFolderPath}/example.html`).then(h => $("#extensions_settings2").append(h));

        $("#kazuma_enable").on("change", (e) => { extension_settings[extensionName].enabled = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_debug").on("change", (e) => { extension_settings[extensionName].debugPrompt = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_url").on("input", (e) => { extension_settings[extensionName].comfyUrl = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_profile").on("change", (e) => { extension_settings[extensionName].connectionProfile = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_auto_enable").on("change", (e) => { extension_settings[extensionName].autoGenEnabled = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_auto_freq").on("input", (e) => { let v = parseInt($(e.target).val()); if (v < 1) v = 1; extension_settings[extensionName].autoGenFreq = v; saveSettingsDebounced(); });

        // SMART WORKFLOW SWITCHER
        $("#kazuma_workflow_list").on("change", (e) => {
            const newWorkflow = $(e.target).val();
            const oldWorkflow = extension_settings[extensionName].currentWorkflowName;

            // 1. Snapshot OLD workflow settings
            if (oldWorkflow) {
                if (!extension_settings[extensionName].savedWorkflowStates) extension_settings[extensionName].savedWorkflowStates = {};
                extension_settings[extensionName].savedWorkflowStates[oldWorkflow] = getWorkflowState();
                console.log(`[${extensionName}] Saved context for ${oldWorkflow}`);
            }

            // 2. Load NEW workflow settings (if they exist)
            if (extension_settings[extensionName].savedWorkflowStates && extension_settings[extensionName].savedWorkflowStates[newWorkflow]) {
                applyWorkflowState(extension_settings[extensionName].savedWorkflowStates[newWorkflow]);
                toastr.success(`Restored settings for ${newWorkflow}`);
            } else {
                // If no saved state, we keep current values (Inheritance) - smoother UX
                toastr.info(`New workflow context active`);
            }

            // 3. Update Pointer
            extension_settings[extensionName].currentWorkflowName = newWorkflow;
            saveSettingsDebounced();
        });
        $("#kazuma_import_btn").on("click", () => $("#kazuma_import_file").click());

        // New Logic Events
        $("#kazuma_prompt_style").on("change", (e) => { extension_settings[extensionName].promptStyle = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_persp").on("change", (e) => { extension_settings[extensionName].promptPerspective = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_art_style").on("change", (e) => { extension_settings[extensionName].promptArtStyle = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_extra").on("input", (e) => { extension_settings[extensionName].promptExtra = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_profile_strategy").on("change", (e) => {
            extension_settings[extensionName].profileStrategy = $(e.target).val();
            toggleProfileVisibility();
            saveSettingsDebounced();
        });

        $("#kazuma_new_workflow").on("click", onComfyNewWorkflowClick);
        $("#kazuma_edit_workflow").on("click", onComfyOpenWorkflowEditorClick);
        $("#kazuma_delete_workflow").on("click", onComfyDeleteWorkflowClick);

        $("#kazuma_model_list").on("change", (e) => { extension_settings[extensionName].selectedModel = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_sampler_list").on("change", (e) => { extension_settings[extensionName].selectedSampler = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_resolution_list").on("change", (e) => {
            const idx = parseInt($(e.target).val());
            if (!isNaN(idx) && RESOLUTIONS[idx]) {
                const r = RESOLUTIONS[idx];
                $("#kazuma_width").val(r.w).trigger("input");
                $("#kazuma_height").val(r.h).trigger("input");
            }
        });

        $("#kazuma_lora_list").on("change", (e) => { extension_settings[extensionName].selectedLora = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_list_2").on("change", (e) => { extension_settings[extensionName].selectedLora2 = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_list_3").on("change", (e) => { extension_settings[extensionName].selectedLora3 = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_list_4").on("change", (e) => { extension_settings[extensionName].selectedLora4 = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_wt").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt = v; $("#kazuma_lora_wt_display").text(v); saveSettingsDebounced(); });
        $("#kazuma_lora_wt_2").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt2 = v; $("#kazuma_lora_wt_display_2").text(v); saveSettingsDebounced(); });
        $("#kazuma_lora_wt_3").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt3 = v; $("#kazuma_lora_wt_display_3").text(v); saveSettingsDebounced(); });
        $("#kazuma_lora_wt_4").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt4 = v; $("#kazuma_lora_wt_display_4").text(v); saveSettingsDebounced(); });

        $("#kazuma_width, #kazuma_height").on("input", (e) => { extension_settings[extensionName][e.target.id === "kazuma_width" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#kazuma_negative").on("input", (e) => { extension_settings[extensionName].customNegative = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_seed").on("input", (e) => { extension_settings[extensionName].customSeed = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#kazuma_compress").on("change", (e) => { extension_settings[extensionName].compressImages = $(e.target).prop("checked"); saveSettingsDebounced(); });

        // Phase 4: Avatar setting change handlers
        $("#kazuma_avatar_character").on("change", (e) => { extension_settings[extensionName].avatarIncludeCharacter = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_avatar_persona").on("change", (e) => { extension_settings[extensionName].avatarIncludePersona = $(e.target).prop("checked"); saveSettingsDebounced(); });

        function bindSlider(id, key, isFloat = false) {
            $(`#${id}`).on("input", function () {
                let v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                extension_settings[extensionName][key] = v;
                $(`#${id}_val`).val(v);
                saveSettingsDebounced();
            });
            $(`#${id}_val`).on("input", function () {
                let v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                extension_settings[extensionName][key] = v;
                $(`#${id}`).val(v);
                saveSettingsDebounced();
            });
        }
        bindSlider("kazuma_steps", "steps", false);
        bindSlider("kazuma_cfg", "cfg", true);
        bindSlider("kazuma_denoise", "denoise", true);
        bindSlider("kazuma_clip", "clipSkip", false);

        // Phase 3: Quality preset and template event handlers
        $("#kazuma_quality_preset").on("change", (e) => {
            applyQualityPreset($(e.target).val());
        });

        $("#kazuma_prompt_template").on("change", (e) => {
            const templateName = $(e.target).val();
            if (templateName) {
                loadPromptTemplate(templateName);
            }
        });

        $("#kazuma_save_template_btn").on("click", () => {
            const templateName = prompt("Enter template name:", "");
            if (templateName) {
                savePromptTemplate(templateName);
            }
        });

        $("#kazuma_delete_template_btn").on("click", () => {
            const templateName = $("#kazuma_prompt_template").val();
            if (templateName) {
                if (confirm(`Delete template "${templateName}"?`)) {
                    deletePromptTemplate(templateName);
                }
            }
        });

        $("#kazuma_export_settings_btn").on("click", exportSettings);

        $("#kazuma_import_settings_btn").on("click", async () => {
            // Show import options dialog
            const choice = await new Promise((resolve) => {
                const $content = $(`
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <p><b>Select import source:</b></p>
                            <button id="import_file" class="menu_button" style="width:100%">
                                <i class="fa-solid fa-file"></i> From File
                            </button>
                            <button id="import_storage" class="menu_button" style="width:100%">
                                <i class="fa-solid fa-database"></i> From localStorage
                            </button>
                            <button id="import_clipboard" class="menu_button" style="width:100%">
                                <i class="fa-solid fa-clipboard"></i> From Clipboard
                            </button>
                        </div>
                    `);

                $content.find("#import_file").on("click", () => resolve("file"));
                $content.find("#import_storage").on("click", () => resolve("storage"));
                $content.find("#import_clipboard").on("click", () => resolve("clipboard"));

                const popup = new Popup($content, POPUP_TYPE.TEXT, "Import Settings", { okButton: "Cancel" });
                popup.show().then(() => resolve(null));
            });

            if (!choice) return;

            if (choice === "file") {
                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = ".json";
                fileInput.addEventListener("change", async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        await importSettings(file);
                    }
                });
                fileInput.click();
            } else if (choice === "storage") {
                importFromLocalStorage();
            } else if (choice === "clipboard") {
                await importFromClipboard();
            }
        });

        // Phase 5: Batch generation event handlers
        $("#kazuma_batch_mode").on("change", (e) => {
            extension_settings[extensionName].batchMode = $(e.target).prop("checked");
            toggleBatchUI();
            saveSettingsDebounced();
        });

        $("#kazuma_batch_count").on("input", (e) => {
            let v = parseInt($(e.target).val());
            v = validateAndClampNumber(v, 1, 100, 3);
            $(e.target).val(v);
            extension_settings[extensionName].batchCount = v;
            saveSettingsDebounced();
        });

        // Phase 6: Cache event handlers
        $("#kazuma_enable_cache").on("change", (e) => {
            extension_settings[extensionName].enableCaching = $(e.target).prop("checked");
            saveSettingsDebounced();
        });

        $("#kazuma_cache_ttl").on("input", (e) => {
            let v = parseInt($(e.target).val());
            v = validateAndClampNumber(v, 1, 1440, 60); // 1 minute to 24 hours
            $(e.target).val(v);
            extension_settings[extensionName].cacheTTL = v * 60000; // Convert to milliseconds
            saveSettingsDebounced();
        });

        $("#kazuma_clear_cache_btn").on("click", clearResponseCache);

        $("#kazuma_test_btn").on("click", onTestConnection);
        $("#kazuma_gen_prompt_btn").on("click", onGeneratePrompt);

        loadSettings();
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.IMAGE_SWIPED, onImageSwiped);

        let att = 0; const int = setInterval(() => { if ($("#kazuma_quick_gen").length > 0) { clearInterval(int); return; } createChatButton(); att++; if (att > 5) clearInterval(int); }, 1000);
        $(document).on("click", "#kazuma_quick_gen", function (e) { e.preventDefault(); e.stopPropagation(); onGeneratePrompt(); });
    } catch (e) { console.error(e); }
});

// Helpers (Condensed)
function onMessageReceived(id) { if (!extension_settings[extensionName].enabled || !extension_settings[extensionName].autoGenEnabled) return; const chat = getContext().chat; if (!chat || !chat.length) return; if (chat[chat.length - 1].is_user || chat[chat.length - 1].is_system) return; const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length; const freq = parseInt(extension_settings[extensionName].autoGenFreq) || 1; if (aiMsgCount % freq === 0) { console.log(`[${extensionName}] Auto-gen...`); setTimeout(onGeneratePrompt, 500); } }
function createChatButton() { if ($("#kazuma_quick_gen").length > 0) return; const b = `<div id="kazuma_quick_gen" class="interactable" title="Visualize" style="cursor: pointer; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; margin-right: 5px; opacity: 0.7;"><i class="fa-solid fa-paintbrush fa-lg"></i></div>`; let t = $("#send_but_sheld"); if (!t.length) t = $("#send_textarea"); if (t.length) { t.attr("id") === "send_textarea" ? t.before(b) : t.prepend(b); } }
function populateProfiles() { const s = $("#kazuma_profile"), o = $("#settings_preset_openai").find("option"); s.empty().append('<option value="">-- Use Current Settings --</option>'); if (o.length) o.each(function () { s.append(`<option value="${$(this).val()}">${$(this).text()}</option>`) }); if (extension_settings[extensionName].connectionProfile) s.val(extension_settings[extensionName].connectionProfile); }
async function onFileSelected(e) { const f = e.target.files[0]; if (!f) return; const t = await f.text(); try { const j = JSON.parse(t), n = prompt("Name:", f.name.replace(".json", "")); if (n) { extension_settings[extensionName].savedWorkflows[n] = j; extension_settings[extensionName].currentWorkflowName = n; saveSettingsDebounced(); populateWorkflows(); } } catch { toastr.error("Invalid JSON"); } $(e.target).val(''); }
function showKazumaProgress(text = "Processing...") {
    $("#kazuma_progress_text").text(text);
    $("#kazuma_progress_overlay").css("display", "flex");
}

function hideKazumaProgress() {
    $("#kazuma_progress_overlay").hide();
}
/* --- WORKFLOW CONTEXT MANAGERS --- */
function getWorkflowState() {
    const s = extension_settings[extensionName];
    // Capture all image-related parameters
    return {
        selectedModel: s.selectedModel,
        selectedSampler: s.selectedSampler,
        steps: s.steps,
        cfg: s.cfg,
        denoise: s.denoise,
        clipSkip: s.clipSkip,
        imgWidth: s.imgWidth,
        imgHeight: s.imgHeight,
        customSeed: s.customSeed,
        customNegative: s.customNegative,
        // Smart Prompts
        promptStyle: s.promptStyle,
        promptPerspective: s.promptPerspective,
        promptExtra: s.promptExtra,
        // LoRAs
        selectedLora: s.selectedLora, selectedLoraWt: s.selectedLoraWt,
        selectedLora2: s.selectedLora2, selectedLoraWt2: s.selectedLoraWt2,
        selectedLora3: s.selectedLora3, selectedLoraWt3: s.selectedLoraWt3,
        selectedLora4: s.selectedLora4, selectedLoraWt4: s.selectedLoraWt4,
    };
}

function applyWorkflowState(state) {
    const s = extension_settings[extensionName];
    // 1. Update Global Settings
    Object.assign(s, state);

    // 2. Update UI Elements
    $("#kazuma_model_list").val(s.selectedModel);
    $("#kazuma_sampler_list").val(s.selectedSampler);

    updateSliderInput('kazuma_steps', 'kazuma_steps_val', s.steps);
    updateSliderInput('kazuma_cfg', 'kazuma_cfg_val', s.cfg);
    updateSliderInput('kazuma_denoise', 'kazuma_denoise_val', s.denoise);
    updateSliderInput('kazuma_clip', 'kazuma_clip_val', s.clipSkip);

    $("#kazuma_width").val(s.imgWidth);
    $("#kazuma_height").val(s.imgHeight);
    $("#kazuma_seed").val(s.customSeed);
    $("#kazuma_negative").val(s.customNegative);

    // Smart Prompt UI
    $("#kazuma_prompt_style").val(s.promptStyle || "standard");
    $("#kazuma_prompt_persp").val(s.promptPerspective || "scene");
    $("#kazuma_prompt_art_style").val(s.promptArtStyle || "realistic");
    $("#kazuma_prompt_extra").val(s.promptExtra || "");

    // LoRA UI
    $("#kazuma_lora_list").val(s.selectedLora);
    $("#kazuma_lora_list_2").val(s.selectedLora2);
    $("#kazuma_lora_list_3").val(s.selectedLora3);
    $("#kazuma_lora_list_4").val(s.selectedLora4);

    // LoRA Weights UI
    $("#kazuma_lora_wt").val(s.selectedLoraWt); $("#kazuma_lora_wt_display").text(s.selectedLoraWt);
    $("#kazuma_lora_wt_2").val(s.selectedLoraWt2); $("#kazuma_lora_wt_display_2").text(s.selectedLoraWt2);
    $("#kazuma_lora_wt_3").val(s.selectedLoraWt3); $("#kazuma_lora_wt_display_3").text(s.selectedLoraWt3);
    $("#kazuma_lora_wt_4").val(s.selectedLoraWt4); $("#kazuma_lora_wt_display_4").text(s.selectedLoraWt4);
}

