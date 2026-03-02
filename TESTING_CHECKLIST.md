# Testing Checklist for Image-gen-kazuma-dork Refactor

## Code Quality Checks

### ✅ Static Analysis
- [ ] Run ESLint on all modules (no critical errors)
- [ ] Verify no console.log in production (except index.js)
- [ ] Check for TODO/FIXME comments
- [ ] Verify all imports/exports are valid

### ✅ Module Structure
- [x] All 10 modules created (constants, logger, utils, cache, api, workflow, generation, batch, core, ui)
- [x] index.js reduced from 2395 lines → 29 lines
- [x] Each module has clear responsibility
- [x] No circular dependencies

---

## Manual Testing (requires live SillyTavern)

### Setup Phase
- [ ] Install extension in SillyTavern `/public/extensions/Image-gen-kazuma-dork/`
- [ ] Check browser console for load errors
- [ ] Verify extension appears in settings

### Lifecycle Tests (Critical Issue #1)
- [ ] **Enable extension** → verify no errors
- [ ] **Disable extension** → verify cleanup() runs (check console for "Extension disabled, cleanup complete")
- [ ] Check browser DevTools → Performance Monitor → **no memory leaks** after disable/enable cycle x5
- [ ] Verify event listeners removed (should see cleanup log)
- [ ] Verify intervals cleared
- [ ] Verify MutationObservers disconnected

### Settings Management (Critical Issue #10)
- [ ] Modify steps slider → verify saves with debounce
- [ ] Apply quality preset → verify all settings update
- [ ] Export settings → verify JSON is valid
- [ ] Import settings → verify validation (try invalid values)
- [ ] Reset to defaults → verify no user data lost

### Security Tests (Critical Issues #9, #11, #21)
- [ ] Try workflow filename with `../` → should be rejected
- [ ] Try URL with `file://` protocol → should be rejected
- [ ] Try settings import with malicious JSON → should validate/sanitize
- [ ] Check error messages → no script tags visible

### Performance Tests (Critical Issue #4)
- [ ] Open chat with 50+ messages → verify UI responsive
- [ ] Cache 100 images → verify O(1) eviction (no UI freeze)
- [ ] Generate image → verify progress bar updates smoothly
- [ ] Batch generate 10 images → verify queue processing

### Generation Workflow
- [ ] Test connection to ComfyUI server → success/error message
- [ ] Load models list → populates dropdown
- [ ] Load samplers list → populates dropdown
- [ ] Create new workflow → editor opens
- [ ] Edit existing workflow → loads JSON
- [ ] Delete workflow → confirms and removes
- [ ] Generate single image → appears in chat
- [ ] Generate with avatar → uses character avatar

### Batch Generation (Issue #29)
- [ ] Start batch (5 images) → verify queue processing
- [ ] Cancel batch mid-generation → verify stops cleanly
- [ ] Retry failed generation → verify retry logic
- [ ] Check batch status → shows progress

### Auto-Generation (Issue #6)
- [ ] Enable auto-gen → sends message → image auto-generates
- [ ] Disable auto-gen → sends message → no image
- [ ] Set frequency to 3 → verify generates every 3 messages

### Chat Button (Critical Issue #5)
- [ ] Verify button appears in send_form area (NO polling loop)
- [ ] Refresh page → verify MutationObserver re-injects button
- [ ] Click button → generates image
- [ ] Check console → no 1-second interval running

---

## Edge Cases

### Empty Chat Handling (Critical Issue #12)
- [ ] Try generation with 0 messages → shows warning
- [ ] Try generation with 1 message → works
- [ ] Try batch with empty chat → prevents start

### Avatar Validation (Critical Issue #3)
- [ ] Load 5000x5000 avatar → should resize to 512px
- [ ] Load 2MB avatar → should compress under 500KB
- [ ] Load missing avatar → should gracefully skip

### Network Resilience
- [ ] Disconnect ComfyUI → verify timeout error (30s)
- [ ] Invalid ComfyUI URL → verify actionable error message
- [ ] Slow network → verify progress shows "waiting"

---

## Regression Tests (Fixed Issues)

### Issue #1 - Cleanup Lifecycle ✅
- [x] Cleanup system tracks all listeners/intervals/observers
- [ ] Disable extension → all resources freed

### Issue #2 - Debug Logging ✅
- [x] Debug mode OFF → no debugLog() output
- [x] Debug mode ON → see detailed logs
- [ ] Toggle debug checkbox → immediate effect

### Issue #3 - Avatar Size Validation ✅
- [x] getAvatarAsBase64() has 512px/500KB limits
- [ ] Test with oversized avatar → verify resize

### Issue #4 - Cache Performance ✅
- [x] cache.js uses Map with timestamp LRU (O(1))
- [ ] Fill cache to capacity → verify no UI freeze

### Issue #5 - Chat Button Polling ✅
- [x] MutationObserver replaces setInterval
- [ ] Check browser DevTools → no 1-second timer

### Issue #6 - Enable/Disable Toggle ✅
- [x] core.enable() / core.disable() implemented
- [ ] Verify state persists across reload

### Issue #7 - Async/Await ✅
- [x] All modules use async/await (no callbacks)
- [x] All promises have .catch() or try/catch

### Issue #8 - Namespace Pollution ✅
- [x] All state in kazumaExtension namespace
- [ ] Check window object → no global kazuma* variables

### Issue #9 - Filename Sanitization ✅
- [x] sanitizeWorkflowFilename() in utils.js
- [ ] Test path traversal → rejected

### Issue #10 - Settings Validation ✅
- [x] validateSettings() in utils.js
- [ ] Test out-of-range values → clamped

### Issue #11 - URL Validation ✅
- [x] validateComfyURL() whitelist HTTP/HTTPS
- [ ] Test file:// → rejected

### Issue #12 - Empty Chat Handling ✅
- [x] checkChatBounds() in utils.js
- [ ] Test generation with 0 messages → warning

---

## Automated Checks (can run now)

```bash
# Check for console.log in production (allowed: logger.js, index.js)
grep -r "console\\.log" src/ --exclude="logger.js" | grep -v "debugLog\|errorLog\|warnLog"

# Check for TODOs
grep -r "TODO\|FIXME" src/

# Count issue coverage (42 issues identified, all should be addressed)
grep -r "Issue #[0-9]" src/ | wc -l

# Verify ES6 module structure
grep -E "^import |^export " src/*.js | wc -l
```

---

## Success Criteria

- [ ] All critical issues (#1-12) testable and passing
- [ ] No memory leaks (5x enable/disable cycle)
- [ ] No security vulnerabilities (path traversal, XSS, invalid URLs rejected)
- [ ] Performance: UI responsive with 100+ cached images
- [ ] All 42 original issues addressed in code
- [ ] Code quality: ESLint clean, no console.log, documented

---

## Module Manifest (for reference)

| Module | Lines | Purpose | Key Issues Fixed |
|--------|-------|---------|------------------|
| **index.js** | 29 | Entry point | - |
| **constants.js** | 185 | Config values | #19 (magic numbers) |
| **logger.js** | 61 | Debug system | #2 (centralized logging) |
| **utils.js** | 338 | Validation/security | #9, #10, #11, #12, #21 |
| **cache.js** | 247 | LRU caching | #4 (O(n) → O(1)) |
| **api.js** | 282 | ComfyUI communication | #11 (URL validation), timeouts |
| **workflow.js** | 374 | Workflow CRUD | Workflow management |
| **generation.js** | 512 | Image pipeline | #3 (avatar validation), #12 |
| **batch.js** | 294 | Batch queue | #29 (cancellation) |
| **core.js** | 565 | Lifecycle/settings | #1 (cleanup), #6 (enable/disable), #8 (namespace) |
| **ui.js** | 668 | UI management | #5 (MutationObserver), #13 (event handlers) |
| **TOTAL** | 3555 | - | 42 issues addressed |

---

## Next Steps After Testing

1. **If tests pass**: Update README with new architecture
2. **If issues found**: Document in GitHub issues and fix
3. **Long-term**: Add unit tests for utils.js validation functions
