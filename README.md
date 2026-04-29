# Instagram Download Browser Extension

A browser extension for downloading media from Instagram and Threads. It adds download controls to posts, reels, stories, highlights, avatars, and profile pages, with configurable filenames and ZIP output.

Source: [fajarmf10/instagram-download-browser-extension](https://github.com/fajarmf10/instagram-download-browser-extension)

## Features

- Download images and videos from Instagram posts, reels, stories, highlights, and profile grids.
- Download profile avatars using the best available HD profile picture URL.
- Download all visible profile posts in one flow from the profile page.
- Choose whether profile batch downloads include images, videos, or both.
- Include reels in profile batch downloads when they are shown on the profile.
- Save profile batches as one ZIP per profile, with an option to place each post in its own folder.
- Batch download available profile highlights into one ZIP.
- Pause, resume, stop, and throttle profile batch downloads.
- Abort on failed profile batch downloads and show an error instead of silently skipping failures.
- Add browser video controls where supported.
- Add optional open-in-new-tab and ZIP buttons.
- Support Threads media downloads.
- Store recently discovered media details locally so repeated downloads can resolve faster.
- Configure the extension from a full-page settings screen.

## Profile Batch Downloads

On an Instagram profile page, the extension adds a `Download All Posts` button below the Follow/Message action row and above highlights.

When clicked, it scans the profile grid, opens a confirmation dialog, and lets you choose:

- Which posts or reels to include.
- Images only, videos only, or both.
- ZIP output or direct file downloads.
- One folder per post inside the profile ZIP.

Tagged posts are not included unless they appear as regular posts or reels on the profile itself.

## Highlight Downloads

The extension adds a `Download Highlights` button below the profile highlights row. Highlight details must be available before the batch ZIP can be created. If the extension asks you to open a highlight first, open one highlight on that profile, return to the profile, and try again.

## Filename Settings

The settings page supports custom filename templates.

Supported tags:

```text
{username}
{id}
{datetime}
{type}
```

Default filename format:

```text
{username}-{id}-{datetime}
```

Default datetime format:

```text
YYYYMMDD_HHmmss
```

## Development

This project uses [pnpm](https://pnpm.io/), [TypeScript](https://www.typescriptlang.org/), [esbuild](https://esbuild.github.io/), and [Vitest](https://vitest.dev/).

Install dependencies:

```bash
pnpm install
```

Run unit tests:

```bash
pnpm test
```

Build for Chrome:

```bash
pnpm run build:chrome
```

Build for Firefox:

```bash
pnpm run build:ff
```

Watch Chrome build during development:

```bash
pnpm run watch:chrome
```

Watch Firefox build during development:

```bash
pnpm run watch:ff
```

## Testing In Chrome

1. Run `pnpm run build:chrome`.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select `dist/chrome`.
6. After each rebuild, click the extension reload button in `chrome://extensions`.
7. Refresh any open Instagram or Threads tabs so the new content script is loaded.

## Testing In Firefox

1. Run `pnpm run build:ff`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select a file inside `dist/firefox`, such as `manifest.json`.
5. Reload the temporary add-on after rebuilding.
6. Refresh any open Instagram or Threads tabs.

## Core Dependencies

- [dayjs](https://github.com/iamkun/dayjs/) ([MIT License](https://github.com/iamkun/dayjs/blob/dev/LICENSE))
- [Preact](https://github.com/preactjs/preact) ([MIT License](https://github.com/preactjs/preact/blob/master/LICENSE))
- [zip.js](https://github.com/gildas-lormeau/zip.js) ([BSD-3-Clause License](https://github.com/gildas-lormeau/zip.js/blob/master/LICENSE))

## Credits

- Original project: [TheKonka/instagram-download-browser-extension](https://github.com/TheKonka/instagram-download-browser-extension)
- Inspired by: [Instagram_Download_Button](https://github.com/y252328/Instagram_Download_Button)

## License

The source code is licensed under MIT. See [LICENSE](./LICENSE).
