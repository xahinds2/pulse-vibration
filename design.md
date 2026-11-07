# Vibration test
Minimal Next.js App Router and plain CSS page based on the supplied reference. Six patterns, duration, repeats, custom timing, Vibrate and Stop. No backend or storage. Android Chrome requests vibration directly from a tap; API acceptance cannot confirm physical motor operation. Cancel on page hiding. Bound custom timing to 19 entries, 1–3000ms each; five repeats maximum. Verify build, browser interactions, mobile layout, then have the user confirm physical vibration through a test link.

## Modern UI and sharing
Three views: Patterns, Remote control, Community. Modern warm-white canvas, dark ink, violet accent, tactile waveform cards and responsive navigation. Pattern editing and a playback panel remain simple. Remote control uses explicit giving/receiving consent through a temporary pairing code; the receiver taps to enable vibration, keeps the page visible, and can revoke control at any time. Receiver polls authenticated commands; never claim motor operation from request acceptance. Pairing expires after 30 minutes. Shared patterns persist in local SQLite with names and attribution, displayed honestly without fabricated users. This is a single-server app; multi-instance deployment requires shared storage. Validate external payloads and rate-limit public writes.

## Android compatibility
Target Android Chrome in a top-level page with a vibration motor. Trigger local requests directly from a tap; remote reception is armed by the receiver's Enable tap. Stop on pagehide/visibility loss, including in-flight pairing. Unsupported browsers can control other phones. Clipboard failure on insecure LAN URLs falls back to selecting the code. Phone controls use at least 44px tap targets; input text is 16px. Physical motor behavior still requires a real Android check.

## Live control
Patterns opens to a compact live pad inspired by the supplied dark-blue/yellow reference. Vertical movement sets pulse rate; horizontal movement sets pulse duty cycle, not hardware intensity. Play runs for 30 seconds unless Loop is enabled. Local drag updates are throttled to 80ms; remote output is serialized and refreshed every 800ms to fit the polling API. Stop, hiding, mode changes and unmount cancel playback. Presets remain accessible with a fixed mobile Play/Stop bar.

## Hosted persistence
Replace SQLite with MongoDB for Vercel deployments. Reuse only the explicitly supplied MongoDB connection and isolate this app in database `pulse`. Do not copy Flux auth, Blob or OIDC settings. Saved patterns persist in MongoDB; remote sessions and rate limits use shared collections and atomic writes so requests work across serverless instances. Keep existing local saved patterns during migration.

## Bottom navigation
Patterns, Remote and Playlist use a fixed bottom bar with safe-area padding. Playlist opens the existing shared collection. Preset transport sits directly above navigation; content reserves space for both bars.

## Phone live workspace
Live mode fills the dynamic viewport with a fixed flex layout, safe-area insets, and no page scrolling. The pad expands into remaining space; chart and header stay compact. Playback stays directly above bottom navigation. Short landscape screens use a side-by-side chart and pad.

## Separate presets tab
Bottom navigation has Live, Presets, Remote and Playlist. Live opens directly to the fullscreen pad without a mode switch; Presets keeps the pattern cards and mobile playback bar.

## Live palette
Live Control uses the same warm-white and lavender palette as the rest of Pulse: pale violet chart/pad, purple trace and handle, and the existing purple primary action.

## Unified connection
Pairing requests microphone permission on both devices and starts WebRTC voice automatically when the controller joins. No separate call or acceptance step. The receiver's tracks stay disabled while waiting; muting before connection is preserved. A compact top row shows connection state, a mute icon, and an end icon. Ending closes voice and remote control together; leaving the page, permission denial, or connection failure releases the microphone. Controls stay mounted across app tabs. Signaling is authenticated; audio is not recorded. STUN is configured; optional RTC_ICE_SERVERS provides TURN for restrictive networks.

## Pairing invitations
Copy invite link copies the app URL with #pair=CODE. Copy invite link is the only invitation action. Opening an invite selects Remote and fills the code; the recipient still taps Pair and grants microphone access. The URL fragment keeps the pairing code out of server request URLs.

A receiver waiting for a partner may background the app to share an invitation. Its microphone remains disabled and voice negotiation waits until the page is visible. Already-connected sessions still disconnect on backgrounding.

## Background and network recovery
App switches preserve pairing and microphone tracks; vibration pauses while hidden. Authenticated polling retries transient failures with capped exponential backoff and resumes immediately on visibility/online events. Pending vibration commands are discarded on resume. Voice keeps healthy WebRTC peers, rebuilds failed calls through authenticated restart signaling without closing the pair, and restores ended microphone tracks when possible. If microphone permission needs interaction, the existing mic icon resumes it. Explicit End, expired sessions and rejected authentication still disconnect. Android can suspend background audio or kill browser processes; this does not guarantee native-app background execution.

## Brand text and icons
Browser title: Pulse — Live Vibration & Voice. Matching purple wave mark in the header, live handle, SVG favicon, 32px ICO and Apple touch icon. Navigation and actions use consistent decorative SVG icons instead of Unicode glyphs. The shared collection is consistently labelled Playlist; support labels describe availability without technical API wording. Secondary text uses darker lavender for readability.

Remote shows Take control first and Give control second, so the pairing code input is immediately accessible on phones.

## Stable device invitations
Receiver invitations persist in MongoDB independently of 30-minute sessions. The owning browser stores an invitation code and private owner token in localStorage. Starting a new receiving session reuses the code; New code revokes the old invitation, issues a replacement, and automatically starts receiving with it. Clearing browser storage or changing browser profiles loses the device identity. Public links contain only the pairing code, never the owner token. Take control is first, with compact mobile spacing to keep the input and connect action above bottom navigation.

## Browser activation
All Vibration API calls, including cancellation, check Chrome's sticky user activation before reaching the browser. This avoids pre-tap cancellation warnings during startup/cleanup. Local Play and receiver pairing remain real tap actions; remote commands cannot bypass the receiving browser's activation requirement.

## Username directory and host settings
Remote replaces pairing-code entry with a public list of active giving users. A generated or custom unique lowercase username persists with a private profile token in this browser. Hosts choose Single (one pending or connected controller) or Multiple (up to eight), Require approval, and Enable voice call before turning on Give control. Only active hosts appear; heartbeat presence expires after 90 seconds, sessions after 30 minutes. Approval gates both vibration and voice at the API. Calls off avoids microphone access entirely. Multiple controllers send to one host; the latest command wins, and each enabled voice connection is between the host and that controller. Host removal revokes one connection; host End revokes all. Controller End closes only that controller. No pairing codes are displayed and profile tokens never appear in the public directory.

## Controller rhythm feedback
Sending live, preset, or playlist rhythms also previews them on the controller device. Local Play and outgoing controller commands schedule a soft 440 Hz tone matching pulse and pause durations through Web Audio, alongside a vibration request. Sound does not depend on the vibration API return value, which cannot establish that a motor exists. Unpaired desktop/iOS users can preview through Play; incoming remote commands remain vibration-only. Playback begins from the controller's interaction and is replaced on rhythm updates. Stop, page navigation, disconnect, live unmount, and failed sending cancel feedback. Background tab/app switching keeps sound and outgoing commands running while the browser permits it. This is a preview of the outgoing command, not confirmation of the remote motor's operation.

## Playback across app screens
Keep Live Control mounted while hidden behind another Pulse tab, preserving the running rhythm, timer, loop and pad position. Keep the live Stop control on the Live tab only. Starting a preset/playlist replaces the live playback; serialize remote stop before its replacement command. Switching browser tabs/apps no longer explicitly stops sound or outgoing live commands. Hidden receiver pages still pause vibration, and browser suspension, timer throttling or device sleep can interrupt playback. Leaving the page ends playback.

## Four-tab navigation
Bottom navigation is Live, Patterns, Control, Users. Patterns groups Presets and the shared Playlist behind a compact collection switch, with the preset transport only shown for Presets. Control contains username, Give control settings and incoming connection approvals. Users contains the available-user directory and joining flow. Live remains mounted across navigation so playback continues.

## Shareable screen routes
Live uses /, Patterns /patterns, Control /control, and Users /users. Next.js links and browser Back/Forward select the screen from the pathname. A shared route-group layout owns the client app so internal route changes preserve playback and connections. Direct navigation and refresh resolve each screen; a full reload still resets active playback/connections.

## Practice profiles
Users includes 15 Indian-name practice profiles, separated from real users with one section-level explanation. Plain names have no Bot badges. Single/Multiple and approval settings vary; approval requests are simulated after 1.5 seconds. All are vibration-only local previews with no microphone or physical receiver. Each browser gets an independent practice connection without database or heartbeat; disconnect clears pending simulated approval.
