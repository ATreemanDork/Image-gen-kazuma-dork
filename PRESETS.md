# 🎯 Image Gen Kazuma Presets

## Overview

Image Gen Kazuma integrates with **SillyTavern's preset system** to provide quick configuration templates. Presets allow you to save and restore entire configuration sets with a single click, making it effortless to switch between different generation styles.

---

## 🎯 Built-in Quality Presets

### Quality Levels

The extension registers **4 quality presets** that optimize the balance between generation speed and image quality:

#### 1. **Low Quality (Fast)**
- **Steps:** 12
- **CFG Scale:** 5.0
- **Denoise:** 0.4
- **Clip Skip:** 2
- **Use Case:** Quick previews, testing prompts, fast iteration
- **Generation Time:** ~10-15 seconds

#### 2. **Medium Quality (Balanced)** ⭐ *Default*
- **Steps:** 20
- **CFG Scale:** 7.0
- **Denoise:** 0.5
- **Clip Skip:** 1
- **Use Case:** General purpose, everyday use
- **Generation Time:** ~20-25 seconds

#### 3. **High Quality (Slower)**
- **Steps:** 30
- **CFG Scale:** 8.0
- **Denoise:** 0.6
- **Clip Skip:** 1
- **Use Case:** Production-quality images, detailed scenes
- **Generation Time:** ~30-40 seconds

#### 4. **Ultra Quality (Maximum)**
- **Steps:** 50
- **CFG Scale:** 9.0
- **Denoise:** 0.75
- **Clip Skip:** 1
- **Use Case:** Final renders, high-detail requirements
- **Generation Time:** ~50-70 seconds

---

## 📋 How to Use Presets

### 1. Access Presets in SillyTavern

1. Open the **Settings** panel (⚙️ icon in SillyTavern)
2. Navigate to **Extensions** → **Image Gen Kazuma**
3. Look for the **Presets** section (auto-populated during init)

### 2. Apply a Preset

**Via Settings UI:**
- Click on any preset name to apply it instantly
- Settings update within 100ms
- Current values are reflected in the UI

**Via Preset Code:**
```javascript
// Example: Apply high quality preset programmatically
import { applyPreset } from './src/core.js';

const highQualitySettings = {
    steps: 30,
    cfg: 8.0,
    denoise: 0.6,
    clipSkip: 1
};

await applyPreset(highQualitySettings);
```

### 3. Save Custom Presets

SillyTavern allows you to save your current settings as a custom preset:

1. Adjust settings to your preferred values
2. In the **Presets** dropdown → **Save Current as Preset**
3. Give it a name (e.g., "My Custom Style")
4. It's now available for quick access

---

## 🔧 Presets & Workflows

### Workflow-Level Persistence

Each **workflow** retains its own preset settings, so:

```
Workflow: SDXL.json
├─ Last used: High Quality
├─ Steps: 30
└─ CFG: 8.0

Workflow: SD15.json
├─ Last used: Medium Quality
├─ Steps: 20
└─ CFG: 7.0
```

When you switch workflows, settings automatically restore to the last configuration for that workflow.

---

## 🛠️ Technical Details

### Preset Registration

During initialization, the extension calls `registerPresets()` which:

1. Checks if `registerExtensionPreset()` is available in SillyTavern
2. Creates preset objects from `QUALITY_PRESETS` constant
3. Filters to only "presetable" fields (excludes diagnostics, debug flags, etc.)
4. Registers each as `"Image Gen - <Label>"`

**Presetable Fields:**
- Generation parameters (steps, cfg, denoise, clipSkip, seed)
- Model/sampler selection (model, sampler, scheduler)
- Prompt configuration (style, perspective, artStyle, extra)
- Image dimensions (width, height)
- LoRA configuration
- Avatar inclusion flags

**Non-Presetable Fields:**
- `debugLogging` (runtime diagnostic)
- `diagnosticMode` (UI state)
- `promptTemplates` (user-specific)
- `activeWorkflow` (workflow-specific)

### Applying Presets

When a preset is applied:

1. **Validation:** Settings are validated using `validateSettings()`
2. **Merging:** Preset values override current settings
3. **Caching:** Updated settings are cached in `kazumaExtension.settings`
4. **Persistence:** Changes saved via SillyTavern's `saveSettingsDebounced()`
5. **Notification:** User sees a success toast message

### Error Handling

- If `registerExtensionPreset` is unavailable, preset registration is skipped silently (non-critical)
- If preset validation fails, an error is logged and user is notified
- Invalid presets are rejected with a descriptive error message

---

## 📚 API Reference

### Core Functions

#### `registerPresets()`
Registers all quality presets with SillyTavern's preset system.

```javascript
export function registerPresets() { ... }
```

**Called:** Automatically during `core.initialize()`
**Error Handling:** Non-critical; logs warning if SillyTavern preset system unavailable

#### `applyPreset(presetSettings)`
Applies a preset to the current configuration.

```javascript
export function applyPreset(presetSettings) { ... }
```

**Parameters:**
- `presetSettings` (object): Settings object to apply

**Returns:** Updated settings object

**Throws:** Error if validation or persistence fails

#### `createPresetObject(partialSettings)`
Creates a filtered preset object containing only presetable fields.

```javascript
function createPresetObject(partialSettings) { ... }
```

**Internal Use:** Called by `registerPresets()` to build preset objects

---

## 💡 Examples

### Example 1: Quick Switch for Testing

```javascript
// Test fast generation
import { applyPreset } from './src/core.js';

await applyPreset({ steps: 12, cfg: 5.0 });  // Low quality
// Generate images quickly to test prompts

await applyPreset({ steps: 30, cfg: 8.0 });  // High quality
// Render final images
```

### Example 2: Character vs. Scene Presets

```javascript
// For character portraits
const characterPreset = {
    promptStyle: 'formal',
    promptPerspective: 'front_view',
    width: 512,
    height: 768,
    steps: 25,
    cfg: 7.5
};

// For full scenes
const scenePreset = {
    promptStyle: 'narrative',
    promptPerspective: 'landscape',
    width: 1024,
    height: 576,
    steps: 30,
    cfg: 8.0
};

await applyPreset(characterPreset);   // Switch to character generation
await applyPreset(scenePreset);       // Switch to scene generation
```

### Example 3: Quality Scaling

```javascript
// Chain presets based on user preference
const qualityScale = {
    'draft': { steps: 12, cfg: 5.0 },
    'balanced': { steps: 20, cfg: 7.0 },
    'quality': { steps: 30, cfg: 8.0 },
    'ultra': { steps: 50, cfg: 9.0 }
};

// Apply based on input
const quality = 'balanced';
await applyPreset(qualityScale[quality]);
```

---

## 🐛 Troubleshooting

### Presets Not Appearing

1. **Check console:** Open DevTools → Console for errors
2. **Verify SillyTavern version:** Presets require a modern ST version with `registerExtensionPreset`
3. **Reload Extension:** Go to Extensions → Reload Image Gen Kazuma

### Changes Not Persisting

1. **Check file permissions:** SillyTavern needs write access to `data/` directory
2. **Verify settings saved:** Check browser console for save errors
3. **Clear cache:** Force refresh (Ctrl+Shift+R) to reload settings

### Preset Conflicts

If multiple extensions register presets with the same name:

1. SillyTavern displays them in the presets dropdown
2. The **last registered** preset wins
3. No error is thrown (by SillyTavern design)

---

## 🚀 Future Enhancements

Potential preset improvements:

- [ ] **Preset Groups:** Organize presets by category (Characters, Environments, etc.)
- [ ] **Conditional Presets:** Apply different presets based on character tags
- [ ] **Preset Branching:** Start from a preset and modify individual settings
- [ ] **Cloud Sync:** Synchronize presets across devices
- [ ] **Preset Sharing:** Export/import preset packages

---

## 📖 Related Documentation

- [README.md](./README.md) - Main extension documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [UI_FUNCTIONALITY_RECONCILIATION.md](./UI_FUNCTIONALITY_RECONCILIATION.md) - UI integration details

---

**Last Updated:** 2025-01-01  
**Extension Version:** 2.0.0+  
**SillyTavern Compatibility:** 1.11.5+
