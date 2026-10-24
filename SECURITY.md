# Security

Joystick Overlay Inputs (JOI) is a single HTML file. It loads no remote code and stores your layout only in the browser's local storage and in files you save yourself. Its only network connection is **Capture Game View**: when you press it, JOI connects to OBS's WebSocket server on this PC (`ws://localhost`), asks for one screenshot and disconnects. The page's Content Security Policy allows nothing else.

The OBS WebSocket password is kept in memory until the page reloads, unless you choose **Remember Password on This PC**. Then it's in the browser's local storage, which other local HTML files can read. It's never written to a layout or profile file.

## Reporting a problem

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for them.

Include what you found, the steps to reproduce it, and the release version you downloaded.

## Verifying a download

Each release lists a SHA-256 checksum for every file it ships, in `SHA256SUMS.txt`. To check a download on Windows, open PowerShell in the folder that holds the zip and run:

```
Get-FileHash JOI.zip -Algorithm SHA256
```

The hash it prints should match the line for that file in `SHA256SUMS.txt`.

## Sharing layouts safely

A shared layout `.json` file is data only: JOI checks every value when it imports one. A `profile.js` file is a script that runs when the overlay loads, so only use one you saved yourself. Never use a `profile.js` someone else sent you.
