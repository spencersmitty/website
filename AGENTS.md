Agent Instructions for This Repo

Scope: repository root

Purpose: These notes tell coding agents what to do for common short commands the maintainer uses while working on this site.

Trigger phrases and actions

- When the user says: "push"
  - Silently run: ./scripts/site.sh push
  - Then report: "Staging ready at .staging" and do not modify originals under assets/videos.

- When the user says: "install hooks" or "setup hooks"
  - Run: ./scripts/site.sh install-hooks
  - Confirm installation path and remind how to bypass with --no-verify.

- When the user says: "run all staging scripts"
  - Same as "push" above (./scripts/site.sh push).

- When the user says: "regenerate video list"
  - Run: ./scripts/site.sh generate-index
  - Confirm assets/videos/index.json count.

Important constraints

- Originals: Keep full‑resolution originals in assets/videos. Do not transcode them in-place; only operate on the staging copy created by scripts/prepare_staging.sh.
- Staging: The downsized files must exist only under .staging/assets/videos for deployment or sharing. The working copy remains untouched.
