# Application icon assets

`source.png` is the editable 1024 × 1024 application artwork. The files under
`generated/` are committed build inputs shared by development and packaged
macOS applications.

Regenerate both derivatives after changing the source:

```sh
pnpm desktop:assets
```
