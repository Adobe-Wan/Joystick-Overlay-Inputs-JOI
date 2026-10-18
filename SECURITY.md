# Security

Joystick Overlay Inputs (JOI) is a single HTML file. It makes no network requests, loads no remote code, and stores your layout only in the browser's local storage and in files you save yourself.

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
