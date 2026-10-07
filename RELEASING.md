# Publishing a new version

1. Replace `StayOnTarget.html` in the repository with the new file and commit it.
2. Create a tag for the version and push it:
   ```
   git tag v1.1.0
   git push origin v1.1.0
   ```
   Or on GitHub: **Releases → Draft a new release → Choose a tag**, type `v1.1.0`, click **Create new tag**, then **Publish release**.
3. The **Release** workflow (Actions tab) builds `StayOnTarget.zip` and publishes the release within a minute or two.

The download link in the README (`releases/latest/download/StayOnTarget.zip`) always serves the newest release, so it never needs editing.

Use `v` + three numbers: bump the last number for fixes (v1.0.1), the middle one for new features (v1.1.0).
