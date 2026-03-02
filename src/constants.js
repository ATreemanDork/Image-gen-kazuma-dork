/**
 * Constants and configuration values for Image Gen Kazuma extension
 * Extracted to prevent magic numbers and centralize configuration
 */

export const CONSTANTS = {
    // Network & API
    FETCH_TIMEOUT_MS: 30000,            // 30 seconds timeout for API calls
    POLL_INTERVAL_MS: 1000,             // 1 second between status checks
    POLL_MAX_ATTEMPTS: 50,              // Maximum 50 attempts (~50 seconds total)

    // Avatar Processing
    MAX_AVATAR_SIZE_PX: 512,            // Resize avatars to max 512x512
    MAX_AVATAR_SIZE_BYTES: 500 * 1024,  // 500KB maximum base64 size
    AVATAR_JPEG_QUALITY: 0.85,           // JPEG compression quality

    // Cache Configuration
    CACHE_MAX_SIZE: 100,                // Maximum cached responses
    CACHE_MAX_AGE_MS: 3600000,          // 1 hour cache lifetime

    // File Handling
    FILENAME_MAX_LENGTH: 255,           // Maximum workflow filename length
    FILENAME_ALLOWED_PATTERN: /^[a-zA-Z0-9_-]+\.json$/, // Whitelist pattern

    // Image Compression
    COMPRESSED_IMAGE_QUALITY: 0.8,      // JPEG quality for chat images
    COMPRESSED_IMAGE_MAX_WIDTH: 1024,   // Max width for compressed images
    COMPRESSED_IMAGE_MAX_HEIGHT: 1024,  // Max height for compressed images

    // UI
    CHAT_BUTTON_CHECK_DELAY_MS: 2000,   // Fallback delay for chat button injection
    DEBOUNCE_DELAY_MS: 300,             // Settings save debounce delay
};

/**
 * Quality presets for quick configuration
 */
export const QUALITY_PRESETS = {
    low: {
        label: "Low (Fast, Lower Quality)",
        settings: {
            steps: 12,
            cfg: 5.0,
            denoise: 0.4,
            clipSkip: 2
        }
    },
    medium: {
        label: "Medium (Balanced)",
        settings: {
            steps: 20,
            cfg: 7.0,
            denoise: 0.5,
            clipSkip: 1
        }
    },
    high: {
        label: "High (Better Quality)",
        settings: {
            steps: 30,
            cfg: 8.0,
            denoise: 0.6,
            clipSkip: 1
        }
    },
    ultra: {
        label: "Ultra (Maximum Quality)",
        settings: {
            steps: 50,
            cfg: 9.0,
            denoise: 0.75,
            clipSkip: 1
        }
    }
};

/**
 * Default extension settings
 * Merged with user settings on initialization
 */
export const DEFAULT_SETTINGS = {
    // Settings version for migrations
    settingsVersion: 1,

    // Core toggles
    enabled: true,
    compress: true,
    debugLogging: false,
    diagnosticMode: false,

    // Server configuration
    comfyUrl: "http://127.0.0.1:8188",

    // Auto-generation
    autoGenerate: false,
    autoGenerateFrequency: 1,

    // Prompt configuration
    promptStyle: "standard",            // standard, illustrious, sdxl
    promptPerspective: "scene",         // scene, pov, character
    promptArtStyle: "realistic",        // realistic, anime, 3d, etc.
    promptExtra: "",

    // Active workflow
    activeWorkflow: "ExampleComfyWorkflow.json",

    // Generation parameters
    steps: 20,
    cfg: 7.0,
    denoise: 0.5,
    clipSkip: 1,
    seed: -1,                           // -1 = random
    sampler: "euler_ancestral",
    scheduler: "normal",

    // Image dimensions
    width: 512,
    height: 512,

    // Model selection
    model: "",

    // Negative prompt
    negativePrompt: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",

    // LoRA configuration (4 slots)
    lora1: "",
    lora1Weight: 1.0,
    lora2: "",
    lora2Weight: 1.0,
    lora3: "",
    lora3Weight: 1.0,
    lora4: "",
    lora4Weight: 1.0,

    // Avatar injection
    includeCharAvatar: false,
    includePersonaAvatar: false,

    // Quality preset
    qualityPreset: "medium",

    // Prompt templates (user-saved)
    promptTemplates: {}
};

/**
 * Placeholder tokens that can be used in ComfyUI workflows
 * Both *token* and %token% formats are supported
 */
export const PLACEHOLDER_TOKENS = {
    input: "Positive prompt from LLM",
    ninput: "Negative prompt from settings",
    seed: "Random or fixed seed",
    steps: "Sampling steps",
    cfg: "CFG scale",
    model: "Checkpoint model name",
    sampler: "Sampler name",
    scheduler: "Scheduler name",
    width: "Image width",
    height: "Image height",
    denoise: "Denoise strength",
    clipSkip: "CLIP skip value",
    lora: "LoRA 1 filename",
    lorawt: "LoRA 1 weight",
    lora2: "LoRA 2 filename",
    lorawt2: "LoRA 2 weight",
    lora3: "LoRA 3 filename",
    lorawt3: "LoRA 3 weight",
    lora4: "LoRA 4 filename",
    lorawt4: "LoRA 4 weight",
    char_avatar: "Character avatar (base64)",
    persona_avatar: "Persona avatar (base64)"
};

/**
 * Validation ranges for numeric settings
 */
export const VALIDATION_RANGES = {
    steps: { min: 1, max: 150, default: 20 },
    cfg: { min: 1.0, max: 30.0, default: 7.0 },
    denoise: { min: 0.0, max: 1.0, default: 0.5 },
    clipSkip: { min: 1, max: 12, default: 1 },
    width: { min: 64, max: 2048, default: 512 },
    height: { min: 64, max: 2048, default: 512 },
    loraWeight: { min: -2.0, max: 2.0, default: 1.0 },
    autoGenerateFrequency: { min: 1, max: 100, default: 1 }
};
