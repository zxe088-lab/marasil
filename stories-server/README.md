# BPB private photo stories — deployment checklist

This branch implements photo stories and photo/text replies. It is not deployed.
The existing App Store build and notification service are unchanged. Video capture/upload is not included in this photo update.

## Behavior
- Server verifies Firebase tokens including revocation and profile existence.
- Mutual contacts with neither side blocked can view, reply and report. All requests enforce expiry using server time, even if R2 has not deleted the object yet.
- Images are decoded/re-encoded to JPEG (EXIF removed), with pixel/byte limits. Story photos use private R2 objects; reads stream through the authenticated API. No public URLs or signed bearer links are returned.
- 20 publications and 100 replies per account per UTC day; 180 API requests per account/minute. Deploy a reverse-proxy rate limit as an additional safeguard before large-scale launch.
- Photos expire 24 hours after publication; scheduled deletion retries every minute. The bucket's one-day lifecycle is a fallback and may delete asynchronously.
- Reply images are compressed into the existing Firestore message (max 500 KB JPEG), **not** the R2 bucket whose lifecycle deletes all objects. Replies follow the application's existing 24-hour message retention from reply time. They are not deleted at the original story's deadline. The quote holds only ID/owner/expiry, never a thumbnail; it becomes “انتهت اليومية”. Permanent chat history is not introduced.
- Views are per user and visible only to the owner. Manual deletion hides first, then deletes storage and views. Reports go to the existing reports collection.
- Contacts list fetch is bounded to 300 contacts. Larger accounts need pagination before rollout.

## Existing VPS paths
`/opt/bpb-push/server.js` is the live push service. Do not overwrite it.
Secrets were entered by the owner under `/home/ubuntu/bpb-push/r2.env` and `firebase-admin.json` (mode 600). Never copy these into Git or the app bundle.

## Install (on the VPS, after transferring this directory)
1. Transfer this entire directory to `/home/ubuntu/bpb-stories` (excluding node_modules), then run `npm ci --omit=dev` there. This installs an isolated, locked dependency set, including the uuid security override; it does not modify the push server dependencies.
2. Keep the four existing R2 settings. Optionally append `STORIES_ORIGINS` as a comma-separated list of exact web origins. Defaults support Capacitor localhost and localhost web. Do not use `*`.
3. Check credentials: `cd /home/ubuntu/bpb-stories && GOOGLE_APPLICATION_CREDENTIALS=/home/ubuntu/bpb-push/firebase-admin.json node --env-file=/home/ubuntu/bpb-push/r2.env server.js --check`. Expect `R2 AND FIREBASE OK`; never print the env file.
4. Add the composite index in `firestore.indexes.json` to the existing Firebase project's index configuration and deploy it. Do not replace unrelated indexes. The `stories` and `storyLimits` collections must remain denied to direct client reads/writes; the existing catch-all deny rules already provide this. No broad rule changes are required.
5. Install `bpb-stories.service` into `/etc/systemd/system/`, run `sudo systemctl daemon-reload`, then `sudo systemctl enable --now bpb-stories`.
6. In the existing TLS Caddy site for `51-254-218-100.sslip.io`, add a route **before any catch-all**:
   ```caddy
   handle /api/stories* {
       reverse_proxy 127.0.0.1:8788
   }
   ```
   Preserve push routing and all unrelated sites. Validate the actual Caddy configuration before reloading. Do not expose port 8788 publicly.
7. `curl http://127.0.0.1:8788/health` should return `{"ok":true}`. An anonymous HTTPS GET `/api/stories` must return 401. Run the full acceptance checks below before any App Store upload.

## Acceptance gates
- Two actual friend accounts publish/view/reply text and photo; verify reply lands in their existing chat and notifications fire.
- A third account, one-sided contact and either-direction block cannot retrieve media by ID.
- Deleted or expired story requests return 410; quote loses image at expiry; captured offline/screenshot copies cannot be remotely revoked.
- Feed works on native iOS and actual approved web origins. Report and owner-only viewers/delete work.
- Delete a user profile: their stories immediately become inaccessible to others; physical cleanup completes by expiry.
- Audit installed dependencies (`npm audit --omit=dev`) and resolve concrete findings without blindly using `--force`.
- Build the independent feature branch with `stories.js` included. Existing workflow guards may intentionally reject non-release branches; do not change them just to bypass release review.

## Local tests
`node --test stories-server/test/*.test.js`
`node tests/stories.browser.cjs`

No live R2/Firebase integration or VPS deployment has been verified in the agent environment: outbound SSH reports Network is unreachable. No credentials are included in these files.
