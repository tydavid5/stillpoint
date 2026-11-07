# Stillpoint file-mode test run (no laptop)

Five has no laptop (said 2026-11-07 ~08:11 WAT). Live camera test is replaced by
the SDK's file mode: a recorded face video fed to the real SDK on this VM.

## Recording spec to give Five (refines the 30-60 s ask sent 2026-11-07 08:13 WAT)

- 65-75 seconds, not 30. HRV confidence stays 0 until 60 s (README timing table),
  so a 30 s clip cannot verify HRV or the full Reset Score. Pulse needs ~12 s,
  breathing ~30 s, HRV ~60 s.
- Front camera, phone propped on something stable, NOT handheld.
- Face centred plus upper chest in frame (SDK validation code 7 is ChestNotVisible;
  breathing needs the chest trace).
- Bright, steady light on the face from the front. No talking, no chewing, sit still.
- Plain top if possible: avoid dark clothing and tight stripes (README positioning).
- Send the video file here (not a link to a compressed chat preview if avoidable).

## Run command (trap: do NOT use the README's bare command)

`node server.js --file path/to/video.mp4` does NOT load `.env`, so KEY is empty,
FAKE becomes true, and the run silently reports simulated signals as if real.

Correct run, from ~/workspace/stillpoint/ with the saved key in .env (0600, gitignored):

```
npm start -- --file /path/to/video.mp4
```

`npm start` is `node --env-file-if-exists=.env server.js`, so the key loads and
SOURCE becomes `file` (hello message). Then open http://127.0.0.1:8080, press Start,
and watch the WebSocket signals.

## What success looks like

- hello {source: "file"}, validation status code 0 (Ok), no auth error.
- Pulse value with confidence > 0 after ~12 s, breathing after ~30 s, HRV object
  (rmssd/sdnn/baevsky) after ~60 s.
- Garden orb moves with the breathing trace.

## Honest caveats

- The key is NOT yet verified: the 2026-11-06 VM test gave error 7 kInputUnavailable
  (no camera) plus TLS pinning failures reaching Presage servers from this VM.
  If the file run fails on network/TLS, that is this VM's network, not proof the
  key is bad. An authentication error on a clean run would mean checking the key
  in the Presage portal.
- The video is for this test only. Do not commit it, do not put it in the repo.
- Demo mode is already verified and labelled, so judges can try Stillpoint with
  no camera; the submission is not blocked if the file run hits the VM network issue.
- Challenge due Nov 22, 2026 11:59 PM PST (Nov 23, 08:59 WAT).
