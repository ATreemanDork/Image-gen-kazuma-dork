# Preset Capability Implementation Summary

## What Was Added

### 1. **Core Preset Functions** (`src/core.js`)

#### `registerPresets()`
- Automatically registers quality presets with SillyTavern's preset system during extension initialization
- Iterates through `QUALITY_PRESETS` from constants
- Creates filtered preset objects containing only "presetable" fields
- Called automatically from `core.initialize()` as a non-critical feature
- Gracefully handles missing SillyTavern preset API with warning-level logging

#### `applyPreset(presetSettings)`
- Applies a preset configuration to current extension settings
- Validates merged settings using `validateSettings()` from utils
- Persists changes via SillyTavern's settings API
- Shows success/error toast messages to user
- Returns updated settings object

#### `createPresetObject(partialSettings)`
- Filters settings to only include presetable fields
- Prevents non-portable fields from being included in presets
- Merges partial overrides with default settings
- Uses allowlist of ~30 presetable fields

### 2. **Preset Definitions** (`src/presets.js`)

New utility module providing:

#### `QUALITY_PRESETS`
- Draft (12 steps, 5.0 CFG)
- Balanced (20 steps, 7.0 CFG)
- Quality (30 steps, 8.0 CFG)
- Maximum (50 steps, 9.0 CFG)

#### Helper Functions
- `getQualityPreset(key)` - Get preset by key
- `listQualityPresets()` - List all quality presets
- `getBaseSettingsPreset(key)` - Get base settings preset
- `listBaseSettingsPresets()` - List base settings presets
- `mergePreset(current, preset)` - Merge two preset objects
- `validatePreset(preset)` - Validate preset structure

**Note:** Also defines `BASE_SETTINGS_PRESETS` for character generation, scene generation, and avatar generation workflows

### 3. **Integration Points**

#### In `src/core.js`
- Added import of `validateSettings` from utils
- Call to `registerPresets()` in `initialize()` function
- Error handling for preset registration failures

#### In existing `src/constants.js`
- Uses existing `QUALITY_PRESETS` (low, medium, high, ultra)
- These are now registered with SillyTavern on init

### 4. **Documentation** (`PRESETS.md`)

Comprehensive guide covering:
- Built-in quality presets with use cases and timing
- How to access and apply presets in SillyTavern UI
- Workflow-level preset persistence
- Technical implementation details
- Presetable vs. non-presetable fields
- API reference for core functions
- Troubleshooting guide
- Future enhancement suggestions

---

## How Presets Work

### Registration Flow
```
Extension Init
   ↓
core.initialize() called
   ├─ Load settings via persistence
   ├─ Set debug mode
   │
   └─ registerPresets() called
      ├─ Check if registerExtensionPreset available
      ├─ Iterate QUALITY_PRESETS
      ├─ Filter to presetable fields
      ├─ Register with "Image Gen - <Label>" format
      └─ Log successes/failures
```

### Preset Application Flow
```
User Clicks Preset in SillyTavern
   ↓
applyPreset(presetSettings) called
   ├─ Validate presetSettings object
   ├─ Get current settings
   ├─ Merge: { ...current, ...preset }
   ├─ Validate merged settings
   ├─ Update kazumaExtension.settings cache
   ├─ Save via ST API (extension_settings)
   ├─ Call saveSettingsDebounced()
   ├─ Show success toast
   └─ Return merged settings
```

---

## Presetable Fields

The allowlist of fields that can be included in presets:

**Generation Quality:**
- steps, cfg, denoise, clipSkip, seed

**Model & Sampling:**
- sampler, scheduler, model

**Prompt Configuration:**
- promptStyle, promptPerspective, promptArtStyle, promptExtra

**Dimensions:**
- width, height

**LoRA Configuration:**
- lora1, lora1Weight, lora2, lora2Weight, lora3, lora3Weight, lora4, lora4Weight

**Media Options:**
- includeCharAvatar, includePersonaAvatar

**Extension Settings:**
- enabled, compress, debugLogging, comfyUrl, autoGenerate, autoGenerateFrequency, activeWorkflow, qualityPreset

---

## Non-Presetable Fields

Fields excluded from presets (too runtime-specific):
- `diagnosticMode` - Runtime UI state
- `settingsVersion` - Metadata
- `promptTemplates` - User-specific templates

---

## Error Handling

### Registration
- If `registerExtensionPreset` not available: Log warning, continue (non-blocking)
- If preset registration fails: Log per-preset error, continue with others

### Application
- If preset is invalid: Log error, throw exception, show error toast
- If validation fails: Log error, throw exception, show error toast
- If persistence fails: Log error, throw exception, show error toast

---

## Testing Recommendations

1. **Quick Test:** Open extension settings, verify preset dropdown appears
2. **Quality Switch:** Apply different quality presets, verify settings update
3. **Persistence:** Apply preset, reload page, verify settings persist
4. **Edge Cases:**
   - Apply preset with invalid data
   - Apply preset when settings not loaded
   - Test in character vs. preset-less mode

---

## Files Modified/Created

| File | Type | Changes |
|------|------|---------|
| `src/core.js` | Modified | Added `registerPresets()`, `applyPreset()`, `createPresetObject()` |
| `src/presets.js` | Created | Utility module with preset helpers and QUALITY_PRESETS variants |
| `PRESETS.md` | Created | Comprehensive preset documentation |
| `src/constants.js` | Existing | `QUALITY_PRESETS` used by registration |

---

## Backward Compatibility

✅ **Fully compatible** -
- Preset registration is non-critical (doesn't block init)
- Gracefully skips if SillyTavern preset API unavailable
- No changes to existing settings structure
- New fields are all optional

---

## Future Enhancements

Potential improvements for future versions:

1. **Preset Groups** - Organize presets by category
2. **Smart Presets** - Apply different presets based on character tags
3. **Custom Presets** - UI for creating and saving custom presets
4. **Preset Import/Export** - Share preset configs between users
5. **Conditional Presets** - Auto-select presets based on workflow
6. **Cloud Sync** - Synchronize presets across devices

---

## Related Documentation

- `README.md` - Main extension documentation
- `ARCHITECTURE.md` - System architecture and module overview
- `UI_FUNCTIONALITY_RECONCILIATION.md` - UI integration details
