# Pulse

A minimal Next.js haptic studio with Patterns, Remote control and a Community library.

Run with Node 24:

```sh
npm install
npm run dev
```

Open http://localhost:3000. For production: `npm run build && npm start`.

Remote control: choose or generate a username. On Android Chrome, select Single or Multiple controllers, Require approval, and Enable voice call, then turn on Give control. Other devices find you in the available-user list and connect or request approval. Multiple mode supports up to eight controllers; the latest vibration command wins. Turn off Give control to remove yourself and disconnect everyone. Sessions last 30 minutes, and unavailable devices disappear after 90 seconds without a heartbeat. Usernames are remembered in this browser; clearing storage loses ownership. The Vibration API cannot confirm physical motor movement.

Community patterns, remote sessions and rate limits persist in MongoDB. Set server-only `MONGODB_URI` and `MONGODB_DB=pulse` in `.env.local` and the Vercel production environment. The database is isolated from Flux. MongoDB must allow connections from the deployment. Local SQLite is no longer used.

Android Chrome is the target browser. Production build and TypeScript pass. A Pixel 7 browser emulation verified local playback, two-browser pairing, remote command delivery, disconnect, and mobile layouts without horizontal overflow or page errors. These checks stubbed the Vibration API: physical Android motor verification is still pending. Open directly in Chrome rather than an embedded social-app browser, keep the screen unlocked and the page visible, and check device vibration / Do Not Disturb settings if requests are silent. Temporary public links require the server and tunnel to remain running and can expire.

## Voice and pairing

When Enable voice call is on, both devices grant microphone permission as they connect. Microphones stay disabled until the connection is accepted. Voice starts automatically with each connected controller; controllers talk with the giving user. With calls off, no microphone permission is requested. Approval is enforced for both voice and vibration.

The compact top bar shows connection status, a mute icon, and an end icon. End disconnects both voice and remote control. Switching apps preserves pairing and voice where the browser permits background audio. Temporary network failures retry automatically; failed voice connections rebuild without pairing again. Ended microphone tracks are restored when possible, with a mic-icon prompt if browser permission requires a tap. Session expiry or End still releases the microphone. Voice persists across app tabs. HTTPS is required outside localhost. Audio is sent using WebRTC and is not recorded by Pulse.

By default WebRTC uses a public STUN server. For calls across restrictive cellular networks, set server-only `RTC_ICE_SERVERS` on Vercel to your STUN/TURN JSON configuration. No TURN service is currently configured. Physical Android microphone and cellular-network testing remain pending.

Background behavior is subject to Android browser suspension and process termination. Pairing is retained in the open page, not restored after a browser process is killed or the page is reloaded. STUN alone cannot guarantee connectivity across all cellular networks; TURN configuration is still needed for restrictive networks.
