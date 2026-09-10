# Connect Firebase once

Firebase connection credentials are imported at runtime and saved in encrypted
Windows app data. They are not embedded in builds or committed to Git. Existing
saved connections continue to work.

On a fresh installation, open **Settings → Account & cloud backup**, choose
**Import JSON & connect**, and select your saved connection file. No API key
entry or new Firebase project is needed when importing that file. Then sign in
with Google. The setup below is only needed to create a connection initially.

Use **Firebase Spark (free)**. This uses Google sign-in and Standard Firestore
directly. No server, Vercel, Auth0, MongoDB, billing account, Cloud Functions, or
Cloud Storage bucket is needed. Keep billing disabled; free quota exhaustion
stops cloud operations until quota becomes available, while local saving works.

1. In the [Firebase console](https://console.firebase.google.com/), create a
   project. Under **Authentication → Sign-in method**, enable **Google** and
   select your support email. Leave other providers disabled.
2. Under **Firestore Database**, create the **Standard edition**, **default**
   database in **production mode**, and choose a region. In its **Rules** tab,
   replace the initial rules with [firestore.rules](firestore.rules) and Publish.
   The app also has a **Copy access rules** button. The `MacroToolboxDB`
   collection is created automatically on the first save.
3. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)
   and select that **same project**. Complete Branding/Audience if prompted:
   choose External for a personal Google account and add your account as a test
   user while testing. Create an OAuth client of type **Desktop app** and
   download its JSON. Firebase already uses this Google project; this does not
   create a second service/account. Only basic `openid email profile` permissions
   are requested. Google's desktop callback uses an available loopback port;
   there is no router or callback URL configuration.
4. In Firebase **Project settings → General**, copy **Web API key**. If it is not
   shown, register a Web app (the `</>` icon, Hosting unchecked) and copy `apiKey`
   from its configuration. In MacroToolbox **Settings → Account & cloud backup**,
   paste the key, select **Import JSON & connect**, and choose the Desktop JSON.
   Select **Sign in with Google**.

If Firebase rejects the Google credential, open its Google sign-in provider,
expand **Whitelist client IDs from external projects**, and add `client_id` from
the Desktop JSON. Do not import a service-account key or a Web OAuth client.
If an API key is restricted, it must allow Identity Toolkit and Token Service
requests from a native desktop app (browser HTTP-referrer restrictions do not
work for native HTTP requests).

After connection, **Save connection file** exports the project configuration
without login tokens or settings. Keep it with your installer: on a fresh
installation, import it and sign in with the same Google account. Keep a private
copy outside this computer before formatting. Connection files contain OAuth
credentials: do not commit them or include them in release artifacts. The local
`firebase/client.local.json` recovery copy is ignored by Git and can be imported
directly. Service-account keys are never needed.

The original v4.3.0 installers contained an embedded connection. Keep those out
of Git and public releases; removing the source JSON does not remove credentials
from existing installers or earlier commits. New builds use runtime import.

## What gets saved

The complete `db.json` configuration and the contents of explicitly linked script
files are included. Folder and overlay images are already embedded in the
database. Sidebar width is migrated from local browser storage into the database.
Unsaved editor drafts, installed programs/interpreters, and files/packages that a
script imports are not included. App executable paths may need changing after a
format. Missing/unreadable linked scripts block upload to preserve the last
complete cloud backup; an intact cloud backup can still be restored.

MacroToolbox checks for changes every 30 seconds while running, including in the
tray. **Sync now** checks immediately. First sign-in with an existing cloud copy
requires choosing **Restore cloud copy** or **Keep this computer**. Changed
remote copies also require a choice, so background sync cannot discard an open
editor. Writes use Firestore preconditions to detect concurrent saves.

Backups are uploaded as immutable 512 KiB chunks. Only a completed upload becomes
the current backup. The previous copy is removed after successful replacement;
this is backup/restore, not version history. An hourly cleanup while signed in
removes abandoned uploads older than a day without paid TTL features. Interrupted
cleanup retries later. Temporary copies also count toward the free storage quota.

Before restoration, a JSON recovery snapshot is written beneath the app-data
folder's `before-cloud-restore` directory. Linked scripts are restored inside
`restored-scripts`, without writing to paths supplied by the remote backup or
overwriting locally edited restored scripts. Recovery files contain `database`
and base64 `files` properties; they are not individual profile exports.
Database schema 4 / snapshot format 1 is supported; later formats must explicitly
add migration support before accepting older backups.

The Firestore rules isolate each Firebase UID. Login credentials are kept in
Windows DPAPI-protected app data, never cloud snapshots. Sign out stops sync but
keeps local settings and the cloud copy. After formatting, sign in again.

## Verification

These checks require the repository's usual authorization for test compilation:

```powershell
node node_modules/typescript/bin/tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml firebase::
```

Before relying on this as your recovery copy, use a configured Firebase project
to sign in, save an image and linked script, and restore from a disposable Windows
profile. Compare the configuration and file contents. Also verify that a second
Google account cannot read the first account's documents; test offline edits,
concurrent saves, interrupted uploads, cancelled sign-in, and restarting with a
saved session. Local unit tests cannot prove live OAuth configuration, deployed
Firestore rules, or Firestore precondition behavior. Run the Copilot smoke cases
in `AGENTS.md` after restore; the normal hook reload path is reused.

## Provider references

- [Free Spark plan](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firestore free quota and document limits](https://firebase.google.com/docs/firestore/quotas)
- [Google desktop OAuth with PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Firebase authentication REST API](https://firebase.google.com/docs/reference/rest/auth)
- [Firestore atomic commits](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit)
