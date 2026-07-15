# FreeKiosk Keyboard Investigation

## Device
- Android 10
- WebView 149.0.7827.163
- Gboard 17.7.7.932364120

## Symptom

Occasionally after dismissing the keyboard, the keyboard disappears but the WebView remains resized, leaving a white region equal to the keyboard height.

Intermittent.

Occurs during login and other text input.

## Already Tried

Patch:
- freekiosk-keyboard-gap-v1.2.19.patch

Goal:
- Eliminate rendering/layout artifacts.

Result:
- No improvement.

Patch:
- freekiosk-screen-keyboard-v1.2.19.patch

Goal:
- Force Google Keyboard because different keyboards were observed between email/password fields.

Result:
- No improvement.

## Current Hypothesis

Likely stale WindowInsets / IME lifecycle rather than rendering.

Need complete investigation of:
- Activity
- WindowInsets
- Immersive mode
- LockTask
- WebView sizing
- JS viewport handling
