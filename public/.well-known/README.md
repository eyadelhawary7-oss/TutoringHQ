# Digital Asset Links (`assetlinks.json`)

This file is served raw at:

    https://centerhq.app/.well-known/assetlinks.json

It is what Android uses to verify the Trusted Web Activity (TWA) / Play app
owns this domain, so the app opens URLs without the browser address bar.

## Permanent application ID

The Android `package_name` is **`app.centerhq`**.

> ⚠️ This application ID is **permanent once the app is published to Google
> Play**. It can never be changed for this listing — a different ID means a
> brand-new, separate app. Use exactly `app.centerhq` in the TWA / Bubblewrap
> build (`packageId` / `applicationId`).

## Filling in the fingerprint (the one remaining manual step)

`sha256_cert_fingerprints` currently holds a placeholder:

    REPLACE_ME__PUT_THE_RELEASE_SIGNING_SHA256_FINGERPRINT_HERE__SEE_README_IN_THIS_FOLDER

Replace it with the SHA-256 fingerprint of the certificate that signs the
release build. The recommended source is **Play App Signing**:

1. Google Play Console → your app → **Test and release → Setup → App signing**.
2. Copy the **SHA-256 certificate fingerprint** under "App signing key
   certificate" (format: `AB:CD:EF:...`, 32 hex pairs).
3. Paste it (keep the colons) into the `sha256_cert_fingerprints` array.

If you are signing locally instead, derive it from the keystore:

    keytool -list -v -keystore <release.keystore> -alias <alias>

You may list multiple fingerprints (e.g. both the upload key and the Play
signing key). After deploying, validate with Google's tester:

    https://developers.google.com/digital-asset-links/tools/generator
