import dayjs from 'dayjs';
import { MESSAGE_FETCH_PROFILE_PICTURE_HD, MediaType } from '../constants';
import { getFilenameFromUrl, getMediaName } from './utils/filename';
import {
    assertAllowedMediaContentType,
    assertValidMediaBlob,
    downloadResource,
    findAppId,
    getAllMediaFromPostId,
    openInNewTab,
} from './utils/fn';
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

interface ProfilePictureResponse {
    url?: string | null;
}

const PROFILE_BULK_DOWNLOAD_BUTTON_CLASS = 'profile-bulk-download-btn';
const PROFILE_BULK_DOWNLOAD_WRAPPER_CLASS = 'profile-bulk-download-wrap';
const PROFILE_BULK_DOWNLOAD_LABEL = 'Download All Posts';
const PROFILE_SCROLL_SETTLE_MS = 900;
const PROFILE_SCROLL_STABLE_ROUNDS = 3;
const PROFILE_SCROLL_MAX_ROUNDS = 80;
const PROFILE_AVATAR_CACHE_KEY = 'user_profile_pic_url';
const PROFILE_AVATAR_HD_CACHE_KEY = 'user_profile_hd_pic_url_v2';
const INSTAGRAM_BLUE = 'rgb(0, 149, 246)';
const INSTAGRAM_BLUE_HOVER = 'rgb(24, 119, 242)';
const INVALID_ZIP_SEGMENT_CHARS_RE = new RegExp(String.raw`[<>:"/\\|?*\x00-\x1F]`, 'g');
export const PROFILE_AVATAR_ACTION_ATTRIBUTE = 'data-profile-avatar-action';

const sleep = (ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
});

function getProfileUsername() {
    const arr = window.location.pathname.split('/').filter((e) => e);
    return arr[0] || document.querySelector('main header h2')?.textContent || undefined;
}

function getSrcsetLargestUrl(srcset: string) {
    return srcset
        .split(',')
        .map((candidate) => candidate.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
}

function getProfileAvatarImage(root: ParentNode = document) {
    const headerIntro = root.querySelector<HTMLElement>('main header > div') ?? root.querySelector<HTMLElement>('main header');
    const images = [...(headerIntro ?? root).querySelectorAll<HTMLImageElement>('img')];

    return images.find((img) => {
        const alt = img.alt.toLowerCase();
        return alt.includes('profile') || alt.includes('profil') || alt.includes(getProfileUsername()?.toLowerCase() || '');
    }) ?? images[0] ?? null;
}

function getProfileAvatarUrl(root: ParentNode = document) {
    const img = getProfileAvatarImage(root);
    if (!img) return undefined;
    return img.currentSrc || getSrcsetLargestUrl(img.srcset) || img.src || undefined;
}

function isLikelyLowResolutionAvatarUrl(url: string) {
    const match = url.match(/(?:^|[/?&_=.-])s(\d{2,4})x(\d{2,4})(?:[_&/.-]|$)/);
    if (!match) return false;
    return Math.max(Number(match[1]), Number(match[2])) <= 150;
}

function findProfileAvatarUser(obj: any): any {
    if (!obj || typeof obj !== 'object') return undefined;
    if (
        typeof obj.username === 'string' &&
        (
            typeof obj.profile_pic_url_hd === 'string' ||
            typeof obj.hd_profile_pic_url_info?.url === 'string' ||
            Array.isArray(obj.hd_profile_pic_versions) ||
            typeof obj.profile_pic_url === 'string'
        )
    ) {
        return obj;
    }

    for (const value of Object.values(obj)) {
        const result = findProfileAvatarUser(value);
        if (result) return result;
    }
}

function getLargestAvatarVersionUrl(versions?: any[]) {
    if (!Array.isArray(versions)) return undefined;
    return [...versions]
        .filter((version) => typeof version?.url === 'string')
        .sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0))[0]?.url;
}

function getProfileAvatarCandidatesFromApiData(data: Record<string, any>) {
    const user = findProfileAvatarUser(data);
    if (!user) return [];

    return [
        { quality: 'high', url: user.profile_pic_url_hd },
        { quality: 'high', url: user.hd_profile_pic_url_info?.url },
        { quality: 'high', url: getLargestAvatarVersionUrl(user.hd_profile_pic_versions) },
        { quality: 'fallback', url: user.profile_pic_url },
    ].filter((candidate): candidate is { quality: 'high' | 'fallback'; url: string } => typeof candidate.url === 'string');
}

function normalizeAvatarCandidateUrl(url: string) {
    return url.replace(/&amp;/g, '&');
}

function getHighResolutionProfileAvatarUrlFromApiData(data: Record<string, any>) {
    const candidates = getProfileAvatarCandidatesFromApiData(data)
        .filter((candidate) => candidate.quality === 'high')
        .map((candidate) => normalizeAvatarCandidateUrl(candidate.url));

    return candidates.find((url) => !isLikelyLowResolutionAvatarUrl(url));
}

function getProfileAvatarUrlFromApiData(data: Record<string, any>) {
    const highResolutionUrl = getHighResolutionProfileAvatarUrlFromApiData(data);
    if (highResolutionUrl) return highResolutionUrl;

    const fallback = getProfileAvatarCandidatesFromApiData(data)[0]?.url;
    return fallback ? normalizeAvatarCandidateUrl(fallback) : undefined;
}

function getProfileUserIdFromApiData(data: Record<string, any>) {
    const user = findProfileAvatarUser(data);
    const id = user?.id || user?.pk || user?.pk_id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

function fetchHighResolutionProfileAvatarUrl(userId: string) {
    return chrome.runtime
        .sendMessage({
            data: { userId },
            type: MESSAGE_FETCH_PROFILE_PICTURE_HD,
        })
        .then((response?: ProfilePictureResponse) => {
            const url = response?.url;
            return typeof url === 'string' && url.trim() ? normalizeAvatarCandidateUrl(url) : undefined;
        })
        .catch((error) => {
            console.log(`Could not fetch HD profile picture: ${error}`);
            return undefined;
        });
}

async function cacheProfileAvatarUrl(username: string, url: string, quality: 'high' | 'fallback' = 'high') {
    const avatarStorage = await chrome.storage.local.get([
        PROFILE_AVATAR_HD_CACHE_KEY,
        PROFILE_AVATAR_CACHE_KEY,
    ]);
    const data = new Map(avatarStorage[PROFILE_AVATAR_CACHE_KEY] || []);
    const hdData = new Map(avatarStorage[PROFILE_AVATAR_HD_CACHE_KEY] || []);
    data.set(username, url);
    if (quality === 'high') {
        hdData.set(username, url);
    }
    await chrome.storage.local.set({
        [PROFILE_AVATAR_CACHE_KEY]: [...data],
        [PROFILE_AVATAR_HD_CACHE_KEY]: [...hdData],
    });
}

async function fetchProfileAvatarUrl(username: string) {
    const appId = findAppId() || '936619743392459';
    const endpoints = [
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(username)}/username/`,
    ];
    const seenEndpoints = new Set<string>();
    let fallbackUrl: string | undefined;

    for (let i = 0; i < endpoints.length; i++) {
        const endpoint = endpoints[i];
        if (seenEndpoints.has(endpoint)) continue;
        seenEndpoints.add(endpoint);
        try {
            const response = await fetch(endpoint, {
                credentials: 'include',
                headers: {
                    Accept: '*/*',
                    'X-IG-App-ID': appId,
                },
                mode: 'cors',
            });
            if (!response.ok) continue;

            const data = await response.json();
            const highResolutionUrl = getHighResolutionProfileAvatarUrlFromApiData(data);
            const fallbackCandidate = getProfileAvatarUrlFromApiData(data);
            const userId = getProfileUserIdFromApiData(data);
            if (userId) {
                const mobileApiUrl = await fetchHighResolutionProfileAvatarUrl(userId);
                if (mobileApiUrl) {
                    await cacheProfileAvatarUrl(username, mobileApiUrl);
                    return mobileApiUrl;
                }

                const userInfoEndpoint = `https://www.instagram.com/api/v1/users/${encodeURIComponent(userId)}/info/`;
                if (!seenEndpoints.has(userInfoEndpoint) && !endpoints.includes(userInfoEndpoint)) {
                    endpoints.splice(i + 1, 0, userInfoEndpoint);
                }
            }

            if (highResolutionUrl) {
                await cacheProfileAvatarUrl(username, highResolutionUrl);
                return highResolutionUrl;
            }

            if (fallbackCandidate) {
                fallbackUrl = fallbackUrl || fallbackCandidate;
            }
        } catch (error) {
            console.log(`Failed to fetch profile avatar from ${endpoint}: ${error}`);
        }
    }

    if (fallbackUrl) {
        await cacheProfileAvatarUrl(username, fallbackUrl, 'fallback');
    }
    return fallbackUrl;
}

async function resolveProfileAvatarUrl(username?: string | null) {
    const avatarStorage = await chrome.storage.local.get([
        PROFILE_AVATAR_HD_CACHE_KEY,
        PROFILE_AVATAR_CACHE_KEY,
    ]);
    const cachedHdUrl = username ? new Map(avatarStorage[PROFILE_AVATAR_HD_CACHE_KEY] || []).get(username) : undefined;
    const cachedUrl = username ? new Map(avatarStorage[PROFILE_AVATAR_CACHE_KEY] || []).get(username) : undefined;
    if (typeof cachedHdUrl === 'string' && !isLikelyLowResolutionAvatarUrl(cachedHdUrl)) {
        return cachedHdUrl;
    }

    const apiUrl = username ? await fetchProfileAvatarUrl(username) : undefined;
    return apiUrl
        || (typeof cachedUrl === 'string' ? cachedUrl : undefined)
        || getProfileAvatarUrl();
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
    document.querySelectorAll<HTMLAnchorElement>('main a[href]').forEach((anchor) => {
        const match = anchor.pathname.match(/^\/(?:[^/]+\/)?(p|reel)\/([^/]+)/);
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

function isVisibleElement(node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isWideProfileAction(node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    return rect.width >= 80 && rect.height >= 28;
}

function getNormalizedText(node: HTMLElement) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

function isLikelyProfileActionControl(node: HTMLElement) {
    if (node.closest(`.${PROFILE_BULK_DOWNLOAD_WRAPPER_CLASS}`)) return false;
    if (node.querySelector('img, canvas')) return false;

    const text = getNormalizedText(node);
    if (node.tagName === 'BUTTON') return text.length > 0 && text.length <= 60;
    return text.length > 0 && text.length <= 40;
}

function findProfileActionRow(profileHeader: HTMLElement) {
    const actionSelector = 'button, div[role="button"]';
    const visibleActions = [...profileHeader.querySelectorAll<HTMLElement>(actionSelector)]
        .filter(isLikelyProfileActionControl)
        .filter(isVisibleElement);
    const wideActions = visibleActions.filter(isWideProfileAction);

    const candidates = new Set<HTMLElement>();
    wideActions.forEach((action) => {
        let node: HTMLElement | null = action.parentElement;
        for (let depth = 0; node && depth < 6 && profileHeader.contains(node); depth++) {
            candidates.add(node);
            node = node.parentElement;
        }
    });

    return [...candidates]
        .filter((node) => node !== profileHeader && isVisibleElement(node))
        .filter((node) => !['BODY', 'HEADER', 'MAIN'].includes(node.tagName))
        .filter((node) => {
            const actions = [...node.querySelectorAll<HTMLElement>(actionSelector)]
                .filter((action) => visibleActions.includes(action));
            const wideActionCount = actions.filter(isWideProfileAction).length;
            return actions.length >= 2 && actions.length <= 5 && wideActionCount >= 2;
        })
        .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return aRect.height - bRect.height || aRect.width - bRect.width;
        })[0] ?? null;
}

function findProfileActionInsertionTarget(actionRow: HTMLElement, profileHeader: HTMLElement) {
    const actionSection = actionRow.closest<HTMLElement>('section');
    if (actionSection && actionSection !== profileHeader && profileHeader.contains(actionSection)) {
        return actionSection;
    }
    return actionRow;
}

function setImportantStyle(node: HTMLElement, property: string, value: string) {
    node.style.setProperty(property, value, 'important');
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
    return value.replace(INVALID_ZIP_SEGMENT_CHARS_RE, '_').replace(/\s+/g, ' ').trim() || 'media';
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
        const contentType = response.headers.get('content-type');
        assertAllowedMediaContentType(contentType, 'Profile media');
        const blob = await response.blob();
        assertValidMediaBlob(blob, contentType, 'Profile media');
        return blob;
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
            controls.throwIfStopped();
            await controls.waitIfPaused();

            const controller = controls.createAbortController();
            try {
                const success = await downloadResource({
                    url: media.url,
                    username: media.owner || getProfileUsername(),
                    datetime: media.taken_at ? dayjs.unix(media.taken_at) : undefined,
                    id: media.id || media.pk || media.origin_data?.id || getMediaName(media.url) || target.code,
                    index: storageCache.settings.setting_format_use_indexing && mediaList.length > 1 ? mediaIndex + 1 : undefined,
                    type: target.kind === 'reel' || media.product_type === 'clips' ? MediaType.Reel : MediaType.Post,
                    signal: controller.signal,
                });
                if (!success) {
                    throw new Error(`Failed to download /${target.kind}/${target.code}`);
                }
            } catch (error: any) {
                if (error?.name === 'AbortError') {
                    throw error;
                }
                throw error;
            } finally {
                controls.clearAbortController(controller);
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
    let wrapper = profileHeader.querySelector<HTMLDivElement>(`.${PROFILE_BULK_DOWNLOAD_WRAPPER_CLASS}`);
    let button = wrapper?.querySelector<HTMLButtonElement>(`.${PROFILE_BULK_DOWNLOAD_BUTTON_CLASS}`);

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = PROFILE_BULK_DOWNLOAD_WRAPPER_CLASS;
    }

    setImportantStyle(wrapper, 'display', 'flex');
    setImportantStyle(wrapper, 'width', '100%');
    setImportantStyle(wrapper, 'margin', '8px 0 0');
    setImportantStyle(wrapper, 'box-sizing', 'border-box');

    if (!button) {
        const createdButton = document.createElement('button');
        createdButton.type = 'button';
        createdButton.className = PROFILE_BULK_DOWNLOAD_BUTTON_CLASS;
        createdButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleProfilePostsDownload(createdButton);
        };
        wrapper.appendChild(createdButton);
        button = createdButton;
    }

    button.dataset.label = PROFILE_BULK_DOWNLOAD_LABEL;
    button.textContent ||= PROFILE_BULK_DOWNLOAD_LABEL;
    setImportantStyle(button, 'appearance', 'none');
    setImportantStyle(button, 'border', '0');
    setImportantStyle(button, 'border-radius', '8px');
    setImportantStyle(button, 'background', INSTAGRAM_BLUE);
    setImportantStyle(button, 'background-color', INSTAGRAM_BLUE);
    setImportantStyle(button, 'color', 'rgb(255, 255, 255)');
    setImportantStyle(button, 'cursor', 'pointer');
    setImportantStyle(button, 'font', 'inherit');
    setImportantStyle(button, 'font-size', '14px');
    setImportantStyle(button, 'font-weight', '600');
    setImportantStyle(button, 'line-height', '18px');
    setImportantStyle(button, 'min-height', '36px');
    setImportantStyle(button, 'padding', '7px 16px');
    setImportantStyle(button, 'text-align', 'center');
    setImportantStyle(button, 'width', '100%');
    button.onmouseenter = () => {
        button.style.setProperty('background-color', INSTAGRAM_BLUE_HOVER, 'important');
    };
    button.onmouseleave = () => {
        button.style.setProperty('background-color', INSTAGRAM_BLUE, 'important');
    };

    const actionRow = findProfileActionRow(profileHeader);
    if (actionRow) {
        const insertionTarget = findProfileActionInsertionTarget(actionRow, profileHeader);
        if (insertionTarget.nextElementSibling !== wrapper) {
            insertionTarget.insertAdjacentElement('afterend', wrapper);
        }
    } else if (!wrapper.isConnected) {
        profileHeader.appendChild(wrapper);
    }
}

export async function profileOnClicked(target: HTMLAnchorElement) {
    const arr = window.location.pathname.split('/').filter((e) => e);
    const username = arr.length === 1 ? arr[0] : document.querySelector('main header h2')?.textContent;
    const url = await resolveProfileAvatarUrl(username);
    if (typeof url === 'string') {
        if (target.className.includes('download-btn')) {
            const success = await downloadResource({
                url: url,
                id: username!,
            });
            if (!success) {
                alert('Avatar download failed. Refresh the profile page and try again.');
            }
        } else {
            openInNewTab(url);
        }
    }
}

export const __profileBulkTestApi = {
    createMediaFilename,
    createProfileBulkProgressDialog,
    downloadBlob,
    getBlobExtension,
    findProfileActionRow,
    findProfileActionInsertionTarget,
    getProfileAvatarImage,
    getProfileAvatarUrl,
    getHighResolutionProfileAvatarUrlFromApiData,
    getProfileAvatarUrlFromApiData,
    getProfileUserIdFromApiData,
    getProfileBulkSettings,
    getProfilePostTargets,
    getNormalizedText,
    isLikelyProfileActionControl,
    isLikelyLowResolutionAvatarUrl,
    isVisibleElement,
    isWideProfileAction,
    isVideoMedia,
    makeDialogButton,
    mergeTargets,
    normalizePath,
    sanitizeZipSegment,
    setBulkButtonState,
    shouldIncludeMedia,
    showProfileBulkConfirmDialog,
    resolveProfileAvatarUrl,
    waitForThrottle,
};
