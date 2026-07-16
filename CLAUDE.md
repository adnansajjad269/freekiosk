# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is FreeKiosk

FreeKiosk is a free, open-source Android kiosk platform built with React Native + TypeScript, with extensive Kotlin native modules for device control. It is designed as an open alternative to Fully Kiosk Browser.

Key capabilities: WebView kiosk, external app launcher, dashboard, media player, 40+ REST API endpoints, MQTT/Home Assistant integration, Device Owner mode, ADB provisioning.

## Commands

```bash
# Development
npm start                           # Start Metro bundler
npm run android                     # Run on connected device/emulator
npm run lint                        # ESLint
npm test                            # Jest unit tests
npm test -- --testPathPattern=foo   # Run a single test file

# Android build
cd android && ./gradlew assembleRelease   # Release APK
cd android && ./gradlew assembleBundle   # Release AAB (Play Store)
```

Output APK: `android/app/build/outputs/apk/release/app-release.apk`

Requirements: Node 20+, JDK 17+, Android SDK 26+.

## Architecture

### React Native ↔ Native Bridge Pattern

Every piece of device functionality lives in a Kotlin module (`android/app/src/main/java/com/freekiosk/`) paired with a TypeScript bridge in `src/utils/`. When adding device-level features, both sides must be updated together.

Key native modules:
- **KioskModule.kt** — lock task, screen on/off, power, home button override
- **AppLauncherModule.kt** — external app lifecycle management
- **BlockingOverlayModule.kt** — draws overlay views to block UI regions
- **HttpServerModule.kt** — embedded HTTP server for REST API
- **FreeKioskAccessibilityService.kt** — accessibility service for back-button/gesture suppression
- **BackgroundAppMonitorService.kt** / **KioskWatchdogService.kt** — foreground services keeping kiosk alive

### State & Storage

`src/utils/storage.ts` is the central persistent state layer (~2000+ lines). All settings, kiosk config, and feature flags are stored via AsyncStorage abstractions here. `src/utils/secureStorage.ts` handles credentials via Keychain. Virtually every component reads settings through these utilities.

### Display Modes

`src/screens/KioskScreen.tsx` is the primary runtime screen. It conditionally renders one of:
- **WebViewComponent** — wraps `react-native-webview` with auto-reload, keyboard avoidance, cookie injection, HTTP basic auth
- **ExternalAppOverlay** — launches and monitors an external Android app
- **MediaPlayerComponent** — video/image slideshow player
- **DashboardGrid** — tile-based launcher

Mode is determined by settings read from storage at startup.

### Settings UI

`src/screens/settings/SettingsScreenNew.tsx` hosts a tabbed settings interface. Each tab is a separate component under `src/screens/settings/tabs/` and `src/components/settings/`. The settings UI uses React Native Paper (Material Design).

### Navigation

Minimal stack: `src/navigation/AppNavigator.tsx` routes between KioskScreen, PinScreen, SettingsScreenNew, and BlockingOverlaysScreen.

### REST API & MQTT

`src/utils/ApiService.ts` handles inbound REST requests (routed through `HttpServerModule`). `src/utils/MqttModule.ts` manages MQTT for Home Assistant discovery. Documentation for all endpoints is in `docs/rest-api.md` and `docs/MQTT.md`.

### Types

Shared TypeScript types for complex features live in `src/types/` — important ones: `managedApps.ts`, `dashboard.ts`, `blockingOverlay.ts`, `screenScheduler.ts`, `planner.ts`.

### Dependency Patches

`patches/` contains patch-package patches applied via `postinstall`. Do not upgrade patched dependencies without verifying the patches still apply.

Current patches:
- **`react-native-webview+13.16.0.patch`** — auto-grant camera/mic permissions in kiosk mode, SSL certificate handling for same-host redirects, a native `DownloadListener` hook routing PDFs to the bundled viewer, and a guard in `RNCWebViewManagerImpl.applyUserAgentString()` that catches the `IllegalArgumentException` Chromium throws for a custom User-Agent containing illegal header characters (it crashed the app on the Fabric mount thread) and falls back to the default UA.
- **`@react-native-community+slider+5.1.1.patch`** — re-entrancy guard in `ReactSliderManager.onProgressChanged()` to stop a `StackOverflowError` when initializing a Slider on Android 8.x (#86).
- **`@react-native-cookies+cookies+6.2.1.patch`** — build/compat fix.
- **`react-native-vision-camera+4.7.3.patch`** — three fixes: (1) guard `CameraDevicesManager` against `getCameraIdList()` returning `null` on cameraless x86 / BlissOS devices, which otherwise throws an NPE during TurboModule init and crashes the app on launch (#187); (2) `runOnUiThreadAndWait()` now routes exceptions back to the suspended coroutine via `resumeWith(Result.failure(e))` instead of letting them escape as an uncaught exception on the UI Handler thread (which crashed the app); (3) `CameraViewModule.takePhoto()` calls `findCameraView()` inside `withPromise` so a `ViewNotFoundError` (CameraView unmounted mid-capture, e.g. motion detection) rejects the promise instead of crashing — the `backgroundCoroutineScope` has no exception handler. Together (2)+(3) fix the `ViewNotFoundError` crash from `findCameraView` reported on v1.2.19.

## Fleet customization: fork-specific feature patches

Separate from the `patches/` dependency patches above, this fork carries its own
feature patches as standalone `.patch` files at the **repo root**
(`freekiosk-*-v1.2.19.patch`). These are **not applied to the `main` branch
source tree** — `main` stays a clean mirror of upstream. Instead they're applied
fresh, on top of a pinned upstream release tag, only during the CI build.

- **`freekiosk-refresh-button-v1.2.19.patch`** (`src/components/WebViewComponent.tsx`)
  — adds a floating manual refresh button (top-center, `⟳`) that calls
  `webViewRef.current?.reload()`. Native `pullToRefreshEnabled` swipe-to-refresh
  is unreliable on non-scrolling / inner-scroll SPA pages, so this gives kiosk
  users a reload affordance that always works regardless of the page's own
  scroll behavior.
- **`freekiosk-keyboard-gap-v1.2.19.patch`** (`android/app/src/main/java/com/freekiosk/MainActivity.kt`)
  — fixes a stale-layout bug after the soft keyboard hides in immersive/kiosk
  mode (where `adjustResize` is ignored, so IME insets are handled manually).
  Two things go stale together: the keyboard-height bottom padding stays
  applied, and Chromium inside the WebView keeps its layout viewport sized to
  screen-minus-keyboard, leaving a blank gap at the bottom of the page. A
  device rotation used to be the only fix (it forces `onSizeChanged` →
  Chromium relayout). The patch resets padding explicitly on IME hide and,
  additionally, does a one-frame 1px height "jiggle" of the content view when
  the IME transitions visible→hidden — a rotation-equivalent trick that forces
  Chromium to rebuild its viewport without an actual rotation.
- **`freekiosk-battery-lock-v1.2.19.patch`** (largest patch; touches
  `MainActivity.kt`, `KioskScreen.tsx`, `AdvancedTab.tsx`, `storage.ts`,
  `BackupService.ts`, and adds `BatteryLockOverlay.tsx` /
  `BatteryLockSection.tsx`) — two-tier low-battery protection:
  - **WARN tier** (amber, acknowledgeable): shows while discharging between the
    freeze and warn thresholds; dismissing it re-arms once the level drops a
    further configurable step; charging clears it.
  - **FREEZE tier** (red, hard lock): a latch that arms at/below the freeze
    threshold and only releases once charged back up to a separate (higher)
    release threshold — so unplugging just above the freeze point doesn't
    immediately re-trigger it, but doesn't let the device wander indefinitely
    on a low charge either.
  - All four thresholds + re-warn step + custom message are configurable via
    a new "Battery Protection" settings section and backed up/restored like
    any other kiosk setting. Also carries a small unrelated tweak to
    `patches/react-native-webview+13.16.0.patch` (SSL-error dialog now
    triggers only for main-frame requests, not sub-resources).

### How the fleet patches are applied

`.github/workflows/build-freekiosk-apk.yml`, manually triggered
(`workflow_dispatch`), builds an installable APK end-to-end on GitHub's
runners:

1. Checks out this fork with full history (tags aren't guaranteed on a fork).
2. Adds `RushB-fr/freekiosk` (upstream) as a remote, fetches its tags, and
   checks out the `source_tag` input (default `v1.2.19`) — the patches are
   written against upstream's source, not this fork's `main`.
3. Applies **all three** fleet patches in a fixed order: battery-lock first,
   then keyboard-gap (`--3way`, since both touch `MainActivity.kt`), then
   refresh-button (no overlap, touches only `WebViewComponent.tsx`).
   **Note**: the workflow's `patch_file` input only names which patch gets
   copied out in step 1 (currently doesn't gate anything, since the other two
   patches are applied unconditionally right after) — treat it as informational,
   not a real switch, until/unless the workflow is refactored to loop over a
   patch list.
4. Bumps `versionCode`/`versionName` in `android/app/build.gradle` so test
   builds install over previous ones.
5. Signs with the fleet's own keystore (repo secrets: `KEYSTORE_BASE64`,
   `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) if set, otherwise falls
   back to the debug key with an explicit warning (fine for a first test, not
   for fleet rollout). Keep signing consistent across builds — Android refuses
   to install an update over an existing app unless it's signed with the same
   key, so losing the keystore means every enrolled device needs a manual
   uninstall/reinstall to pick up a future update.

### Working conventions for fleet patches

- New FreeKiosk feature requirements for this fleet's use case should follow
  the same pattern as the existing three: a standalone `.patch` file at the
  repo root (not merged into `main`), named `freekiosk-<feature>-v<tag>.patch`,
  written against the same pinned upstream tag the others target unless there's
  a reason to move to a newer one.
- If a new patch is added, wire it into `build-freekiosk-apk.yml`'s apply
  sequence (mind patch ordering/overlaps the way keyboard-gap and
  battery-lock both had to account for touching `MainActivity.kt`).
