# GGIS UAV Companion (Android)

Installed on the drone **controller** (DJI/Autel smart controller, or an Android
phone/tablet on the RC). It signs in with Pilot Ops credentials, finds the pilot's
**live mission**, then **mirrors the whole controller screen** — the flight app's
FPV feed + telemetry overlay — and casts it to that flight's Pilot Ops livestream
with sub-second latency. The cast is recorded server-side and attached to the flight.

## How it works

```
MediaProjection screen capture → H.264/AAC (RootEncoder)
   → RTMP/SRT to MediaMTX, path = <flightId>, ?token=<supabase access token>
   → stream-gateway validates the token + flight, MediaMTX republishes as WebRTC
   → Pilot Ops "Live stream" plays it.
```

Drone-agnostic: it captures the screen, so it works with any flight app, regardless
of drone brand.

## Build

Open the `android/` folder in Android Studio, or build from the CLI. Verified
toolchain: **JDK 17+ (Android Studio's bundled JBR works), Gradle 8.11.1 (wrapper
included), Android Gradle Plugin 8.9.1, Kotlin 2.3.21, compileSdk 36, RootEncoder
2.7.5**. The SDK platform/build-tools auto-download on first build.

1. Set the deployment values (Pilot Ops domain + anon key). Either edit
   `gradle.properties`, or pass `-P` flags / put them in `~/.gradle/gradle.properties`:
   ```
   SUPABASE_URL=https://YOUR_DOMAIN
   SUPABASE_ANON_KEY=<your anon key>
   STREAM_HOST=YOUR_DOMAIN          # where the controller pushes RTMP/SRT
   STREAM_SCHEME=rtmp               # rtmp (1935) or srt (8890)
   ```
2. Build a debug APK:
   ```
   ./gradlew :app:assembleDebug
   ```
   Output: `app/build/outputs/apk/debug/app-debug.apk`.

## Sideload onto a controller

```
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Use

1. In Pilot Ops, start the mission. The "Mission started" screen shows a **6-digit
   pairing code** and waits for the controller.
2. Open **GGIS UAV Companion**, sign in with a Pilot Ops login.
3. Enter the **pairing code** and tap **Connect to mission** (this works for the
   pilot, a co-pilot, or a shared controller). Or tap *Use my active mission* to
   skip the code if you're the pilot-in-command.
4. Tap **Start casting**, accept Android's screen-capture prompt. The controller
   screen now appears in that flight's **Live stream**, and Pilot Ops flips to
   "Controller connected".
5. Tap **Stop casting** to end; the recording is uploaded and attached to the flight.

## Notes / limits

- **DRM / secure surfaces:** MediaProjection cannot capture `FLAG_SECURE` content.
  Most FPV apps render on normal surfaces; confirm with a stock screen recorder on
  your specific controller before relying on it.
- Default encode is 720p30 ≈ 2.5 Mbps — tune `FPS`/`BITRATE` in
  `stream/ScreenCastService.kt` for your uplink.
- Ports the server must expose: RTMP `1935/tcp` (or SRT `8890/udp`) for ingest,
  and `8189/udp` for WebRTC playback. See the repo's `DEPLOY.md`.
- Streaming uses [RootEncoder](https://github.com/pedroSG94/RootEncoder).
