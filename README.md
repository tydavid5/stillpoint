# Stillpoint

A 60-second reset garden that grows only when your body actually slows down.

Sit still in front of your camera for 60 seconds, before an interview, exam, match, trade, or hard conversation. Your breathing makes a glowing orb rise and fall. Your pulse sets its glow. A smile adds sunlight. Talking or moving dims it. At the end you get a Reset Score, measured against your own start, not against anyone else.

This is a submission for the Presage SmartSpectra SDK Challenge on DEV, Nov 4-22, 2026. It is entered for Best Overall Human-Sensing Experience, Most Creative or Delightful Use, and Best Thoughtful Real-World Use.

## What it uses

- Presage SmartSpectra SDK for Node.js, `@smartspectra/node-sdk` 3.4.0
- Pulse rate, breathing rate and upper chest waveform, HRV (RMSSD, SDNN, Baevsky Stress Index), blink, talking, and facial expressions
- A Node server plus WebSocket to a page on localhost, because there is no pure browser SDK. The Node process must run on the machine with the camera.

## How to run

1. Install Node 20 or later.
2. `npm install`
3. Get a free API key at https://physiology.presagetech.com/auth/register, copy `.env.example` to `.env`, and put the key in `SMARTSPECTRA_API_KEY`. Never commit `.env`.
4. `npm start`
5. Open http://localhost:8080
6. Read the consent screen, press Start, sit still, and do not talk for 60 seconds.

Demo mode, no camera and no key:

```
npm run fake
```

Then open http://localhost:8080 and use the sliders. Demo mode is clearly labelled DEMO MODE on the page, in orange, and it never presents simulated signals as real.

List cameras:

```
npm run list-cameras
```

Use a file instead of a camera (a recorded 30 to 60 second video of a still, well-lit face):

```
npm start -- --file path/to/video.mp4
```

(Use `npm start`, not bare `node server.js`, because only `npm start` loads `.env`, so only it picks up your key. Bare `node server.js --file` runs without a key and silently falls back to demo mode.)

## Positioning

- Face and upper chest visible, lit from the front
- Sit still, camera stable, not handheld
- Do not talk during the session, breathing cannot be read reliably while talking
- Avoid dark clothing, tightly striped clothing, chewing gum, and flickering light

## Timing, and why a session is 60 seconds

- Pulse rate: about 12 seconds, 40 to 110 BPM, confidence 0 until the window fills
- Breathing rate: about 30 seconds, 5 to 40 breaths per minute, confidence 0 until 30 seconds
- HRV: about 60 seconds, confidence 0 until 60 seconds
- Breathing waveforms follow the breathing rate confidence

Baseline is the first 10 seconds. The end is the last 10 seconds. The Reset Score compares your end with your own start: breathing up to 40 points, pulse up to 30, stress index up to 20 (10 if HRV was not ready yet), smile up to 10, minus up to 10 for talking or moving a lot. The full formula in plain words is shown on the results screen.

## Consent and data handling

- The camera starts only when you press Start, and stops when you press Stop or the session ends.
- Video is processed locally by the SmartSpectra SDK on this machine. No video is stored, uploaded, or shared.
- SDK telemetry is off (`enableTelemetry: false`), so no telemetry session is started.
- No account, no login, no analytics, no third party AI service.
- Session numbers are kept in your browser localStorage only if you press Save after a session. Press Delete to remove them. Nothing leaves the machine.
- If you run the demo mode, the signals are simulated on the server and are labelled as simulated on the page.

## Disclaimer

Readings are for general wellness and informational purposes only. They are not a medical diagnosis, and they do not diagnose, treat, or decide anything medical. Stillpoint is not a medical device and must not be used for medical decision making.
