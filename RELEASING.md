# Publishing a new version

1. Replace `StayOnTarget.html` in the repository with the new file and commit it (on GitHub: open the file, click the pencil or **Add file → Upload files**, then **Commit changes**).
2. Go to the **Actions** tab → **Release** → **Run workflow**, type the new version (for example `v1.1.0`) and click **Run workflow**.
3. In a minute or two the release appears on the **Releases** page with `StayOnTarget.zip` attached.

Pushing a version tag from the command line (`git tag v1.1.0 && git push origin v1.1.0`) does the same thing.

The download link in the README (`releases/latest/download/StayOnTarget.zip`) always serves the newest release, so it never needs editing.

Use `v` + three numbers: bump the last number for fixes (v1.0.1), the middle one for new features (v1.1.0).
