import dayjs from 'dayjs';
import { MediaType } from '../constants';
import { getFilenameFromUrl, getMediaName } from './utils/filename';
import { downloadResource, getAllMediaFromPostId, openInNewTab } from './utils/fn';
import { storageCache } from './utils/storage';

type ProfileTargetKind = 'p' | 'reel';
type ProfileBulkMediaFilter = 'both' | 'images' | 'videos';

interface ProfilePostTarget {
    code: string;
    href: string;
    kind: ProfileTargetKind;
}

interface ProfileBulkSettings {
    includeReels: boolean;
    mediaFilter: ProfileBulkMediaFilter;
    saveAsZip: boolean;
    throttleMs: number;
    zipPostFolders: boolean;
}

interface ProfileBulkProgressDialog {
    clearAbortController: (controller: AbortController) => void;
    close: () => void;
    createAbortController: () => AbortController;
    setProgress: (current: number, total: number) => void;
    setStatus: (status: string) => void;
    throwIfStopped: () => void;
    waitIfPaused: () => Promise<void>;
}

const PROFILE_BULK_DOWNLOAD_BUTTON_CLASS = 'profile-bulk-download-btn';
const PROFILE_BULK_DOWNLOAD_WRAPPER_CLASS = 'profile-bulk-download-wrap';
const PROFILE_BULK_DOWNLOAD_LABEL = 'Download All Posts';
const PROFILE_SCROLL_SETTLE_MS = 900;
const PROFILE_SCROLL_STABLE_ROUNDS = 3;
const PROFILE_SCROLL_MAX_ROUNDS = 80;

const sleep = (ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
});

function getProfileUsername() {
    const arr = window.location.pathname.split('/').filter((e) => e);
    return arr[0] || document.querySelector('main header h2')?.textContent || undefined;
}

function getProfileBulkSettings(): ProfileBulkSettings {
    const {
        setting_profile_bulk_include_reels,
        setting_profile_bulk_media_filter,
        setting_profile_bulk_save_as_zip,
        setting_profile_bulk_throttle_ms,
        setting_profile_bulk_zip_post_folders,
    } = storageCache.settings;

    const mediaFilter = ['images', 'videos'].includes(setting_profile_bulk_media_filter || '')
        ? setting_profile_bulk_media_filter as ProfileBulkMediaFilter
        : 'both';

    return {
        includeReels: setting_profile_bulk_include_reels ?? true,
        mediaFilter,
        saveAsZip: setting_profile_bulk_save_as_zip ?? true,
        throttleMs: Math.max(0, Number(setting_profile_bulk_throttle_ms ?? 500)),
        zipPostFolders: setting_profile_bulk_zip_post_folders ?? true,
    };
}

function getProfilePostTargets(includeReels: boolean) {
    const targets = new Map<string, ProfilePostTarget>();
    document.querySelectorAll<HTMLAnchorElement>('main a[href^="/p/"], main a[href^="/reel/"]').forEach((anchor) => {
        const match = anchor.pathname.match(/^\/(p|reel)\/([^/]+)/);
        if (!match) return;

        const kind = match[1] as ProfileTargetKind;
        if (kind === 'reel' && !includeReels) return;

        const code = match[2];
        targets.set(`${kind}:${code}`, {
            code,
            href: anchor.href,
            kind,
        });
    });
    return [...targets.values()];
}

function mergeTargets(targets: Map<string, ProfilePostTarget>, nextTargets: ProfilePostTarget[]) {
    nextTargets.forEach((target) => {
        targets.set(`${target.kind}:${target.code}`, target);
    });
}

function setBulkButtonState(button: HTMLButtonElement, label: string, busy: boolean) {
    button.textContent = label;
    button.disabled = busy;
    button.style.opacity = busy ? '0.75' : '1';
    button.style.cursor = busy ? 'progress' : 'pointer';
}

function findProfileActionRow(profileHeader: HTMLElement) {
    return [...profileHeader.querySelectorAll<HTMLElement>('div')]
        .reverse()
        .find((node) => {
            if (!node.offsetParent) return false;
            const actions = node.querySelectorAll('button, a[role="link"], div[role="button"]');
            return actions.length >= 2;
        }) ?? null;
}

function normalizePath(pathname: string) {
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

async function waitForPath(pathname: string) {
    const expectedPath = normalizePath(pathname);
    const startedAt = Date.now();
    while (Date.now() - startedAt < 6000) {
        if (normalizePath(window.location.pathname) === expectedPath) return true;
        await sleep(120);
    }
    return false;
}

async function navigateToProfileTab(username: string, pathname: string) {
    const normalizedPathname = normalizePath(pathname);
    const link = document.querySelector<HTMLAnchorElement>(`a[href="${normalizedPathname}"], a[href="${normalizedPathname.slice(0, -1)}"]`);
    if (!link) return false;

    link.click();
    return waitForPath(`/${username}${normalizedPathname.replace(`/${username}`, '')}`);
}

async function collectVisibleTimelineTargets(
    includeReels: boolean,
    onStatus: (status: string) => void,
) {
    const scroller = document.scrollingElement;
    const initialScrollY = window.scrollY;
    const targets = new Map<string, ProfilePostTarget>();
    let stableRounds = 0;
    let lastCount = 0;

    for (let round = 0; round < PROFILE_SCROLL_MAX_ROUNDS && stableRounds < PROFILE_SCROLL_STABLE_ROUNDS; round++) {
        mergeTargets(targets, getProfilePostTargets(includeReels));
        onStatus(`Scanning posts... ${targets.size}`);

        if (!scroller) break;

        const previousHeight = scroller.scrollHeight;
        window.scrollTo(0, previousHeight);
        await sleep(PROFILE_SCROLL_SETTLE_MS);
        const nextHeight = scroller.scrollHeight;

        if (targets.size === lastCount && nextHeight === previousHeight) {
            stableRounds += 1;
        } else {
            stableRounds = 0;
        }

        lastCount = targets.size;
    }

    window.scrollTo(0, initialScrollY);
    return targets;
}

async function collectAllProfileTargets(button: HTMLButtonElement, settings: ProfileBulkSettings) {
    const username = getProfileUsername();
    const initialPath = normalizePath(window.location.pathname);
    const targets = new Map<string, ProfilePostTarget>();

    const mainTargets = await collectVisibleTimelineTargets(settings.includeReels, (status) => setBulkButtonState(button, status, true));
    mergeTargets(targets, [...mainTargets.values()]);

    if (settings.includeReels && username && initialPath === `/${username}/`) {
        setBulkButtonState(button, 'Opening reels tab...', true);
        const openedReels = await navigateToProfileTab(username, `/${username}/reels/`);
        if (openedReels) {
            await sleep(PROFILE_SCROLL_SETTLE_MS);
            const reelTargets = await collectVisibleTimelineTargets(true, (status) => setBulkButtonState(button, status, true));
            mergeTargets(targets, [...reelTargets.values()]);
            setBulkButtonState(button, 'Returning to posts...', true);
            await navigateToProfileTab(username, `/${username}/`);
            await sleep(PROFILE_SCROLL_SETTLE_MS);
        }
    }

    return [...targets.values()];
}

function getOverlayBaseStyle() {
    return [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:rgba(0,0,0,0.52)',
        'padding:24px',
    ].join(';');
}

function getDialogStyle(width = 620) {
    return [
        `width:min(${width}px,100%)`,
        'max-height:min(720px,90vh)',
        'display:flex',
        'flex-direction:column',
        'gap:16px',
        'border-radius:12px',
        'background:#fffdfa',
        'color:#17201b',
        'box-shadow:0 24px 80px rgba(0,0,0,0.32)',
        'font-family:Segoe UI Variable, Segoe UI, system-ui, sans-serif',
        'padding:22px',
    ].join(';');
}

function makeDialogButton(label: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    const colors: Record<typeof variant, string> = {
        danger: 'background:#a13b32;color:#fff',
        primary: 'background:#146c5f;color:#fff',
        secondary: 'background:#eef1ed;color:#17201b',
    };
    button.setAttribute(
        'style',
        [
            'border:0',
            'border-radius:8px',
            'cursor:pointer',
            'font:inherit',
            'font-weight:700',
            'min-height:38px',
            'padding:8px 13px',
            colors[variant],
        ].join(';')
    );
    return button;
}

function showProfileBulkConfirmDialog(targets: ProfilePostTarget[], mediaFilter: ProfileBulkMediaFilter) {
    return new Promise<{ mediaFilter: ProfileBulkMediaFilter; targets: ProfilePostTarget[] } | null>((resolve) => {
        const overlay = document.createElement('div');
        overlay.setAttribute('style', getOverlayBaseStyle());

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('style', getDialogStyle());

        const title = document.createElement('h2');
        title.textContent = 'Confirm Profile Download';
        title.setAttribute('style', 'margin:0;font-size:22px;line-height:1.2');

        const summary = document.createElement('p');
        summary.textContent = `Found ${targets.length} profile ${targets.length === 1 ? 'item' : 'items'}. Choose what to include before the ZIP is created.`;
        summary.setAttribute('style', 'margin:0;color:#65706a;line-height:1.45');

        const mediaLabel = document.createElement('label');
        mediaLabel.textContent = 'Media type';
        mediaLabel.setAttribute('style', 'display:grid;gap:7px;font-weight:700');

        const mediaSelect = document.createElement('select');
        mediaSelect.setAttribute('style', 'min-height:40px;border:1px solid #dedbd3;border-radius:8px;padding:8px 10px;font:inherit');
        [
            ['both', 'Images and videos'],
            ['images', 'Images only'],
            ['videos', 'Videos only'],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.selected = value === mediaFilter;
            mediaSelect.appendChild(option);
        });
        mediaLabel.appendChild(mediaSelect);

        const list = document.createElement('div');
        list.setAttribute('style', 'display:grid;gap:8px;overflow:auto;border:1px solid #dedbd3;border-radius:8px;padding:10px;min-height:140px;max-height:300px');

        targets.forEach((target, index) => {
            const row = document.createElement('label');
            row.setAttribute('style', 'display:flex;gap:10px;align-items:center;font-weight:650');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.dataset.targetKey = `${target.kind}:${target.code}`;

            const text = document.createElement('span');
            text.textContent = `${String(index + 1).padStart(3, '0')} /${target.kind}/${target.code}`;
            text.setAttribute('style', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap');

            row.append(checkbox, text);
            list.appendChild(row);
        });

        const utilityRow = document.createElement('div');
        utilityRow.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-start');
        const selectAllButton = makeDialogButton('Select All');
        const clearButton = makeDialogButton('Clear');
        selectAllButton.onclick = () => {
            list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
                checkbox.checked = true;
            });
        };
        clearButton.onclick = () => {
            list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
                checkbox.checked = false;
            });
        };
        utilityRow.append(selectAllButton, clearButton);

        const actions = document.createElement('div');
        actions.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap');
        const cancelButton = makeDialogButton('Cancel');
        const downloadButton = makeDialogButton('Download Selected', 'primary');

        cancelButton.onclick = () => {
            overlay.remove();
            resolve(null);
        };
        downloadButton.onclick = () => {
            const selectedKeys = new Set(
                [...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((checkbox) => checkbox.dataset.targetKey)
            );
            overlay.remove();
            resolve({
                mediaFilter: mediaSelect.value as ProfileBulkMediaFilter,
                targets: targets.filter((target) => selectedKeys.has(`${target.kind}:${target.code}`)),
            });
        };

        actions.append(cancelButton, downloadButton);
        dialog.append(title, summary, mediaLabel, list, utilityRow, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    });
}

function createProfileBulkProgressDialog(totalTargets: number): ProfileBulkProgressDialog {
    const overlay = document.createElement('div');
    overlay.setAttribute('style', getOverlayBaseStyle());

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('style', getDialogStyle(520));

    const title = document.createElement('h2');
    title.textContent = 'Downloading Profile ZIP';
    title.setAttribute('style', 'margin:0;font-size:22px;line-height:1.2');

    const status = document.createElement('p');
    status.textContent = 'Preparing...';
    status.setAttribute('style', 'margin:0;color:#65706a;line-height:1.45');

    const progressOuter = document.createElement('div');
    progressOuter.setAttribute('style', 'height:10px;overflow:hidden;border-radius:999px;background:#dfe5df');

    const progressInner = document.createElement('div');
    progressInner.setAttribute('style', 'height:100%;width:0%;background:#146c5f;transition:width 160ms ease');
    progressOuter.appendChild(progressInner);

    const actions = document.createElement('div');
    actions.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap');

    const pauseButton = makeDialogButton('Pause');
    const stopButton = makeDialogButton('Stop', 'danger');
    actions.append(pauseButton, stopButton);

    dialog.append(title, status, progressOuter, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let paused = false;
    let stopped = false;
    let activeAbortController: AbortController | null = null;

    pauseButton.onclick = () => {
        paused = !paused;
        pauseButton.textContent = paused ? 'Resume' : 'Pause';
        status.textContent = paused ? 'Paused' : status.textContent.replace(/^Paused$/, 'Resuming...');
    };

    stopButton.onclick = () => {
        stopped = true;
        paused = false;
        pauseButton.textContent = 'Pause';
        status.textContent = 'Stopping...';
        activeAbortController?.abort();
    };

    return {
        clearAbortController(controller) {
            if (activeAbortController === controller) {
                activeAbortController = null;
            }
        },
        close() {
            overlay.remove();
        },
        createAbortController() {
            const controller = new AbortController();
            activeAbortController = controller;
            if (stopped) controller.abort();
            return controller;
        },
        setProgress(current, total) {
            const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
            progressInner.style.width = `${percentage}%`;
        },
        setStatus(nextStatus) {
            status.textContent = nextStatus;
        },
        throwIfStopped() {
            if (stopped) {
                throw new Error('Profile download stopped.');
            }
        },
        async waitIfPaused() {
            while (paused && !stopped) {
                await sleep(200);
            }
            if (stopped) {
                throw new Error('Profile download stopped.');
            }
        },
    };
}

function isVideoMedia(media: Record<string, any>) {
    return Boolean(media.video_versions?.length || media.media_type === 2 || media.product_type === 'clips');
}

function shouldIncludeMedia(media: Record<string, any>, filter: ProfileBulkMediaFilter) {
    if (filter === 'both') return true;
    return filter === 'videos' ? isVideoMedia(media) : !isVideoMedia(media);
}

function sanitizeZipSegment(value: string) {
    return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'media';
}

function getBlobExtension(blob: Blob, isVideo: boolean) {
    const extension = blob.type.split('/').pop() || (isVideo ? 'mp4' : 'jpg');
    return storageCache.settings.setting_format_replace_jpeg_with_jpg ? extension.replace('jpeg', 'jpg') : extension;
}

async function fetchMediaBlob(url: string, controls: ProfileBulkProgressDialog) {
    controls.throwIfStopped();
    await controls.waitIfPaused();

    const controller = controls.createAbortController();
    try {
        const response = await fetch(url, {
            headers: new Headers({
                Origin: location.origin,
            }),
            mode: 'cors',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch media (${response.status})`);
        }
        return response.blob();
    } finally {
        controls.clearAbortController(controller);
    }
}

async function waitForThrottle(ms: number, controls: ProfileBulkProgressDialog) {
    const endAt = Date.now() + ms;
    while (Date.now() < endAt) {
        controls.throwIfStopped();
        await controls.waitIfPaused();
        await sleep(Math.min(200, endAt - Date.now()));
    }
}

function downloadBlob(blob: Blob, filename: string) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(blobUrl);
    }, 100);
}

async function createMediaFilename(
    target: ProfilePostTarget,
    media: Record<string, any>,
    mediaIndex: number,
    mediaCount: number,
    blob: Blob,
) {
    const mediaType = target.kind === 'reel' || media.product_type === 'clips' ? MediaType.Reel : MediaType.Post;
    const filename = await getFilenameFromUrl({
        url: media.url,
        username: media.owner || getProfileUsername(),
        datetime: media.taken_at ? dayjs.unix(media.taken_at) : undefined,
        id: media.id || media.pk || media.origin_data?.id || getMediaName(media.url) || target.code,
        index: storageCache.settings.setting_format_use_indexing && mediaCount > 1 ? mediaIndex + 1 : undefined,
        type: mediaType,
    });

    return `${sanitizeZipSegment(filename)}.${getBlobExtension(blob, isVideoMedia(media))}`;
}

async function resolveTargetMedia(target: ProfilePostTarget, filter: ProfileBulkMediaFilter) {
    const mediaList = await getAllMediaFromPostId(target.code, target.kind);
    if (!mediaList?.length) {
        throw new Error(`Could not resolve media for /${target.kind}/${target.code}`);
    }
    return mediaList.filter((media) => shouldIncludeMedia(media, filter));
}

async function downloadProfileAsZip(
    targets: ProfilePostTarget[],
    settings: ProfileBulkSettings,
    mediaFilter: ProfileBulkMediaFilter,
    controls: ProfileBulkProgressDialog,
) {
    const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js');
    const zipFileWriter = new BlobWriter();
    const zipWriter = new ZipWriter(zipFileWriter);
    let downloadedFiles = 0;

    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const target = targets[targetIndex];
        controls.setProgress(targetIndex, targets.length);
        controls.setStatus(`Resolving ${targetIndex + 1}/${targets.length}: /${target.kind}/${target.code}`);
        const mediaList = await resolveTargetMedia(target, mediaFilter);

        for (let mediaIndex = 0; mediaIndex < mediaList.length; mediaIndex++) {
            const media = mediaList[mediaIndex];
            controls.setStatus(`Adding ${targetIndex + 1}/${targets.length}: ${mediaIndex + 1}/${mediaList.length}`);
            const blob = await fetchMediaBlob(media.url, controls);
            const filename = await createMediaFilename(target, media, mediaIndex, mediaList.length, blob);
            const prefix = settings.zipPostFolders
                ? `${String(targetIndex + 1).padStart(3, '0')}-${target.kind}-${sanitizeZipSegment(target.code)}/`
                : `${String(targetIndex + 1).padStart(3, '0')}-${target.kind}-${sanitizeZipSegment(target.code)}-`;

            await zipWriter.add(`${prefix}${filename}`, new BlobReader(blob), {
                useWebWorkers: false,
            });
            downloadedFiles += 1;
            await waitForThrottle(settings.throttleMs, controls);
        }
    }

    if (downloadedFiles === 0) {
        throw new Error('No media matched the selected filters.');
    }

    controls.setProgress(targets.length, targets.length);
    controls.setStatus('Finalizing ZIP...');
    const zipContent = await zipWriter.close();
    const username = getProfileUsername() || 'profile';
    const zipFilename = await getFilenameFromUrl({
        url: '',
        username,
        datetime: dayjs(),
        id: 'profile',
        type: MediaType.Post,
    });
    downloadBlob(zipContent, `${sanitizeZipSegment(zipFilename)}.zip`);
    return downloadedFiles;
}

async function downloadProfileAsFiles(
    targets: ProfilePostTarget[],
    settings: ProfileBulkSettings,
    mediaFilter: ProfileBulkMediaFilter,
    controls: ProfileBulkProgressDialog,
) {
    let downloadedFiles = 0;

    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const target = targets[targetIndex];
        controls.setProgress(targetIndex, targets.length);
        controls.setStatus(`Resolving ${targetIndex + 1}/${targets.length}: /${target.kind}/${target.code}`);
        const mediaList = await resolveTargetMedia(target, mediaFilter);

        for (let mediaIndex = 0; mediaIndex < mediaList.length; mediaIndex++) {
            const media = mediaList[mediaIndex];
            controls.setStatus(`Downloading ${targetIndex + 1}/${targets.length}: ${mediaIndex + 1}/${mediaList.length}`);
            const success = await downloadResource({
                url: media.url,
                username: media.owner || getProfileUsername(),
                datetime: media.taken_at ? dayjs.unix(media.taken_at) : undefined,
                id: media.id || media.pk || media.origin_data?.id || getMediaName(media.url) || target.code,
                index: storageCache.settings.setting_format_use_indexing && mediaList.length > 1 ? mediaIndex + 1 : undefined,
                type: target.kind === 'reel' || media.product_type === 'clips' ? MediaType.Reel : MediaType.Post,
            });
            if (!success) {
                throw new Error(`Failed to download /${target.kind}/${target.code}`);
            }
            downloadedFiles += 1;
            await waitForThrottle(settings.throttleMs, controls);
        }
    }

    if (downloadedFiles === 0) {
        throw new Error('No media matched the selected filters.');
    }

    controls.setProgress(targets.length, targets.length);
    return downloadedFiles;
}

async function handleProfilePostsDownload(button: HTMLButtonElement) {
    if (button.dataset.loading === 'true') return;

    button.dataset.loading = 'true';
    const originalLabel = button.dataset.label || PROFILE_BULK_DOWNLOAD_LABEL;
    const settings = getProfileBulkSettings();
    let progressDialog: ProfileBulkProgressDialog | null = null;

    try {
        const targets = await collectAllProfileTargets(button, settings);
        if (targets.length === 0) {
            alert('No profile posts were found to download.');
            return;
        }

        const choice = await showProfileBulkConfirmDialog(targets, settings.mediaFilter);
        if (!choice) return;
        if (choice.targets.length === 0) {
            alert('Select at least one post to download.');
            return;
        }

        progressDialog = createProfileBulkProgressDialog(choice.targets.length);
        const downloadedFiles = settings.saveAsZip
            ? await downloadProfileAsZip(choice.targets, settings, choice.mediaFilter, progressDialog)
            : await downloadProfileAsFiles(choice.targets, settings, choice.mediaFilter, progressDialog);

        progressDialog.setStatus(`Complete. Added ${downloadedFiles} ${downloadedFiles === 1 ? 'file' : 'files'}.`);
        await sleep(1200);
    } catch (e: any) {
        const message = e?.name === 'AbortError'
            ? 'Profile download stopped.'
            : e?.message || 'Profile download failed.';
        progressDialog?.setStatus(message);
        alert(message);
        console.log(`Uncaught in handleProfilePostsDownload(): ${e}\n${e?.stack}`);
    } finally {
        progressDialog?.close();
        button.dataset.loading = 'false';
        setBulkButtonState(button, originalLabel, false);
    }
}

export function ensureProfileBulkDownloadButton(profileHeader: HTMLElement) {
    if (profileHeader.querySelector(`.${PROFILE_BULK_DOWNLOAD_BUTTON_CLASS}`)) return;

    const wrapper = document.createElement('div');
    wrapper.className = PROFILE_BULK_DOWNLOAD_WRAPPER_CLASS;
    wrapper.setAttribute('style', 'display:flex;width:100%;margin-top:12px;');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = PROFILE_BULK_DOWNLOAD_BUTTON_CLASS;
    button.dataset.label = PROFILE_BULK_DOWNLOAD_LABEL;
    button.textContent = PROFILE_BULK_DOWNLOAD_LABEL;
    button.setAttribute(
        'style',
        [
            'appearance:none',
            'border:0',
            'border-radius:8px',
            'background:var(--ig-secondary-button-background, rgb(239, 239, 239))',
            'color:var(--ig-primary-text, rgb(0, 0, 0))',
            'cursor:pointer',
            'font:inherit',
            'font-size:14px',
            'font-weight:600',
            'line-height:18px',
            'min-height:36px',
            'padding:7px 16px',
            'text-align:center',
            'width:100%',
        ].join(';')
    );
    button.onmouseenter = () => {
        button.style.setProperty('filter', 'brightness(0.96)');
    };
    button.onmouseleave = () => {
        button.style.removeProperty('filter');
    };
    button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleProfilePostsDownload(button);
    };

    wrapper.appendChild(button);

    const actionRow = findProfileActionRow(profileHeader);
    if (actionRow) {
        actionRow.insertAdjacentElement('afterend', wrapper);
    } else {
        profileHeader.appendChild(wrapper);
    }
}

export async function profileOnClicked(target: HTMLAnchorElement) {
    const { user_profile_pic_url } = await chrome.storage.local.get(['user_profile_pic_url']);
    const data = new Map(user_profile_pic_url || []);
    const arr = window.location.pathname.split('/').filter((e) => e);
    const username = arr.length === 1 ? arr[0] : document.querySelector('main header h2')?.textContent;
    const url = data.get(username) || document.querySelector('header img')?.getAttribute('src');
    if (typeof url === 'string') {
        if (target.className.includes('download-btn')) {
            downloadResource({
                url: url,
                id: username!,
            });
        } else {
            openInNewTab(url);
        }
    }
}
