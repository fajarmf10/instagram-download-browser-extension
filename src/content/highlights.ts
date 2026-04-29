import dayjs from 'dayjs';
import {
    assertAllowedMediaContentType,
    assertValidMediaBlob,
    checkType,
    downloadResource,
    openInNewTab,
} from './utils/fn';
import { DownloadParams, getFilenameFromUrl, getMediaName } from './utils/filename';
import type { Highlight } from '../types/highlights';
import type { ReelsMedia } from '../types/global';
import { MediaType } from "../constants";
import { storageCache } from './utils/storage';

const HIGHLIGHTS_BATCH_BUTTON_CLASS = 'highlights-bulk-download-btn';
const HIGHLIGHTS_BATCH_WRAPPER_CLASS = 'highlights-bulk-download-wrap';
const INSTAGRAM_BLUE = 'rgb(0, 149, 246)';
const INSTAGRAM_BLUE_HOVER = 'rgb(24, 119, 242)';
const INVALID_ZIP_SEGMENT_CHARS_RE = new RegExp(String.raw`[<>:"/\\|?*\x00-\x1F]`, 'g');

interface HighlightTarget {
    id: string;
    href: string;
    title: string;
}

function getSectionNode(target: HTMLAnchorElement) {
    let sectionNode: HTMLElement = target;
    while (sectionNode.tagName !== 'SECTION' && sectionNode.parentElement) {
        sectionNode = sectionNode.parentElement;
    }
    return sectionNode;
}

function findHighlight(obj: Record<string, any>): Highlight.XdtApiV1FeedReelsMediaConnection | undefined {
    for (const key in obj) {
        if (key === 'xdt_api__v1__feed__reels_media__connection') {
            return obj[key];
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            const result = findHighlight(obj[key]);
            if (result) {
                return result;
            }
        }
    }
}

function sanitizeZipSegment(value: string) {
    return value.replace(INVALID_ZIP_SEGMENT_CHARS_RE, '_').replace(/\s+/g, ' ').trim() || 'highlight';
}

function getHighlightTargets(root: ParentNode = document) {
    const targets = new Map<string, HighlightTarget>();
    root.querySelectorAll<HTMLAnchorElement>('main header a[href*="/stories/highlights/"]').forEach((anchor) => {
        const match = anchor.pathname.match(/^\/stories\/highlights\/([^/]+)/);
        if (!match) return;

        const id = match[1];
        const rawTitle = anchor.getAttribute('aria-label') || anchor.textContent || id;
        const title = rawTitle.replace(/^View highlight\s+/i, '').replace(/^Lihat sorotan\s+/i, '').trim() || id;
        targets.set(id, { id, href: anchor.href, title });
    });
    return [...targets.values()];
}

function getHighlightMediaUrl(item: Highlight.Item) {
    return item.video_versions?.[0]?.url || item.image_versions2?.candidates?.[0]?.url;
}

function getHighlightBlobExtension(blob: Blob, item: Highlight.Item) {
    const extension = blob.type.split('/').pop() || (item.video_versions?.length ? 'mp4' : 'jpg');
    return storageCache.settings.setting_format_replace_jpeg_with_jpg ? extension.replace('jpeg', 'jpg') : extension;
}

function resolveCachedHighlightNodes(targets: HighlightTarget[], highlightsData: unknown) {
    const data = new Map(Array.isArray(highlightsData) ? highlightsData as [string, Highlight.Node][] : []);
    return targets
        .map((target) => ({
            target,
            node: data.get(`highlight:${target.id}`) || data.get(target.id),
        }))
        .filter((item): item is { target: HighlightTarget; node: Highlight.Node } => Boolean(item.node?.items?.length));
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

async function createHighlightItemFilename(node: Highlight.Node, item: Highlight.Item, index: number, total: number, blob: Blob) {
    const filename = await getFilenameFromUrl({
        url: getHighlightMediaUrl(item) || '',
        username: node.user.username,
        datetime: dayjs.unix(item.taken_at),
        id: item.id || item.pk || node.id,
        index: storageCache.settings.setting_format_use_indexing && total > 1 ? index + 1 : undefined,
        type: MediaType.Highlight,
    });
    return `${sanitizeZipSegment(filename)}.${getHighlightBlobExtension(blob, item)}`;
}

async function downloadHighlightsAsZip(items: { target: HighlightTarget; node: Highlight.Node }[]) {
    const { BlobReader, BlobWriter, ZipWriter } = await import('@zip.js/zip.js');
    const zipFileWriter = new BlobWriter();
    const zipWriter = new ZipWriter(zipFileWriter);
    let fileCount = 0;

    for (let highlightIndex = 0; highlightIndex < items.length; highlightIndex++) {
        const { target, node } = items[highlightIndex];
        for (let itemIndex = 0; itemIndex < node.items.length; itemIndex++) {
            const item = node.items[itemIndex];
            const url = getHighlightMediaUrl(item);
            if (!url) {
                throw new Error(`Highlight ${target.title} contains an unsupported media item.`);
            }

            const response = await fetch(url, {
                headers: new Headers({ Origin: location.origin }),
                mode: 'cors',
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch highlight media (${response.status}).`);
            }
            const contentType = response.headers.get('content-type');
            assertAllowedMediaContentType(contentType, `Highlight ${target.title}`);

            const blob = await response.blob();
            assertValidMediaBlob(blob, contentType, `Highlight ${target.title}`);
            const filename = await createHighlightItemFilename(node, item, itemIndex, node.items.length, blob);
            const folder = `${String(highlightIndex + 1).padStart(2, '0')}-${sanitizeZipSegment(target.title || node.title || target.id)}/`;
            await zipWriter.add(`${folder}${filename}`, new BlobReader(blob), { useWebWorkers: false });
            fileCount += 1;
        }
    }

    if (fileCount === 0) {
        throw new Error('No highlight media was available to download.');
    }

    const zipContent = await zipWriter.close();
    const username = items[0]?.node.user.username || window.location.pathname.split('/').filter(Boolean)[0] || 'profile';
    const zipFilename = await getFilenameFromUrl({
        url: '',
        username,
        datetime: dayjs(),
        id: 'highlights',
        type: MediaType.Highlight,
    });
    downloadBlob(zipContent, `${sanitizeZipSegment(zipFilename)}.zip`);
    return fileCount;
}

async function handleHighlightsBatchDownload(button: HTMLButtonElement) {
    if (button.dataset.loading === 'true') return;

    const originalLabel = button.dataset.label || 'Download Highlights';
    button.dataset.loading = 'true';
    button.disabled = true;
    button.textContent = 'Preparing highlights...';

    try {
        const targets = getHighlightTargets();
        if (targets.length === 0) {
            alert('No profile highlights were found.');
            return;
        }

        const { highlights_data } = await chrome.storage.local.get(['highlights_data']);
        const items = resolveCachedHighlightNodes(targets, highlights_data);
        if (items.length === 0) {
            alert('Highlight details are not ready yet. Open one highlight first, then try Download Highlights again.');
            return;
        }

        const skipped = targets.length - items.length;
        const message = skipped > 0
            ? `Download ${items.length} available highlights as one ZIP? ${skipped} highlight(s) need to be opened first.`
            : `Download ${items.length} highlights as one ZIP?`;
        if (!window.confirm(message)) return;

        button.textContent = 'Downloading highlights...';
        const count = await downloadHighlightsAsZip(items);
        button.textContent = `Downloaded ${count} files`;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
    } catch (error: any) {
        const message = error?.message || 'Highlight download failed.';
        alert(message);
        console.log(`Uncaught in handleHighlightsBatchDownload(): ${error}\n${error?.stack}`);
    } finally {
        button.dataset.loading = 'false';
        button.disabled = false;
        button.textContent = originalLabel;
    }
}

function getHighlightsSection(root: ParentNode = document) {
    const firstHighlightLink = root.querySelector<HTMLAnchorElement>('main header a[href*="/stories/highlights/"]');
    return firstHighlightLink?.closest<HTMLElement>('section') ?? null;
}

export function ensureHighlightsBatchDownloadButton(root: ParentNode = document) {
    const highlightsSection = getHighlightsSection(root);
    if (!highlightsSection) return;

    let wrapper = highlightsSection.parentElement?.querySelector<HTMLDivElement>(`:scope > .${HIGHLIGHTS_BATCH_WRAPPER_CLASS}`);
    let button = wrapper?.querySelector<HTMLButtonElement>(`.${HIGHLIGHTS_BATCH_BUTTON_CLASS}`);
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = HIGHLIGHTS_BATCH_WRAPPER_CLASS;
    }
    wrapper.style.setProperty('display', 'flex', 'important');
    wrapper.style.setProperty('width', '100%', 'important');
    wrapper.style.setProperty('margin', '8px 0 0', 'important');
    wrapper.style.setProperty('box-sizing', 'border-box', 'important');

    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = HIGHLIGHTS_BATCH_BUTTON_CLASS;
        button.dataset.label = 'Download Highlights';
        button.textContent = 'Download Highlights';
        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleHighlightsBatchDownload(button!);
        };
        wrapper.appendChild(button);
    }

    button.style.setProperty('appearance', 'none', 'important');
    button.style.setProperty('border', '0', 'important');
    button.style.setProperty('border-radius', '8px', 'important');
    button.style.setProperty('background', INSTAGRAM_BLUE, 'important');
    button.style.setProperty('background-color', INSTAGRAM_BLUE, 'important');
    button.style.setProperty('color', 'rgb(255, 255, 255)', 'important');
    button.style.setProperty('cursor', 'pointer', 'important');
    button.style.setProperty('font', 'inherit', 'important');
    button.style.setProperty('font-size', '14px', 'important');
    button.style.setProperty('font-weight', '600', 'important');
    button.style.setProperty('line-height', '18px', 'important');
    button.style.setProperty('min-height', '36px', 'important');
    button.style.setProperty('padding', '7px 16px', 'important');
    button.style.setProperty('text-align', 'center', 'important');
    button.style.setProperty('width', '100%', 'important');
    button.onmouseenter = () => {
        button!.style.setProperty('background-color', INSTAGRAM_BLUE_HOVER, 'important');
    };
    button.onmouseleave = () => {
        button!.style.setProperty('background-color', INSTAGRAM_BLUE, 'important');
    };

    if (highlightsSection.nextElementSibling !== wrapper) {
        highlightsSection.insertAdjacentElement('afterend', wrapper);
    }
}

export async function highlightsOnClicked(target: HTMLAnchorElement) {
    const sectionNode = getSectionNode(target);
    const pathname = window.location.pathname; // "/stories/highlights/18023929792378379/"
    const pathnameArr = pathname.split('/');
    const { setting_format_use_indexing } = storageCache.settings;

    const final = (url: string, filenameObj?: Omit<DownloadParams, 'url' | 'type'>) => {
        if (target.className.includes('download-btn')) {
            if (filenameObj) {
                downloadResource({
                    url: url,
                    ...filenameObj,
                    type: MediaType.Highlight,
                });
            } else {
                let posterName = 'highlights';
                for (const item of sectionNode.querySelectorAll('a[role=link]')) {
                    const hrefArr = item
                        .getAttribute('href')
                        ?.split('/')
                        .filter((_) => _);
                    if (hrefArr?.length === 1) {
                        posterName = hrefArr[1];
                        break;
                    }
                }
                const postTime = [...sectionNode.querySelectorAll('time')].find((i) => i.classList.length !== 0)
                                                                          ?.getAttribute('datetime');
                downloadResource({
                    url: url,
                    username: posterName,
                    datetime: postTime,
                    id: getMediaName(url),
                    type: MediaType.Highlight,
                });
            }
        } else {
            openInNewTab(url);
        }
    };

    let mediaIndex = 0;

    const handleMedias = (data: Highlight.Node) => {
        const media = data.items[mediaIndex];
        const url = media.video_versions?.[0].url || media.image_versions2.candidates[0].url;
        final(url, {
            username: data.user.username,
            datetime: dayjs.unix(media.taken_at),
            id: data.id,
            index: setting_format_use_indexing ? mediaIndex + 1 : undefined
        });
    };

    target.parentElement?.firstElementChild?.querySelectorAll(':scope>div').forEach((i, idx) => {
        if (i.childNodes.length === 1) {
            mediaIndex = idx;
        }
    });

    const { reels_media, highlights_data } = await chrome.storage.local.get(['reels_media', 'highlights_data']);

    //  profile page highlight on Android
    if (checkType() === 'android') {
        sectionNode.querySelectorAll('header>div:nth-child(1)>div').forEach((item, index) => {
            item.querySelectorAll('div').forEach((i) => {
                if (i.classList.length === 2) {
                    mediaIndex = index;
                }
            });
        });
        const itemOnAndroid = (reels_media || []).find((i: ReelsMedia.ReelsMedum) => i.id === 'highlight:' + pathnameArr[3]);
        if (itemOnAndroid) {
            handleMedias(itemOnAndroid);
            return;
        }
        for (const item of sectionNode.querySelectorAll<HTMLImageElement>('img')) {
            if (item.srcset !== '') {
                final(item.src);
                return;
            }
        }
    }

    const localData = new Map(highlights_data || []).get('highlight:' + pathnameArr[3]) as Highlight.Node | undefined;
    if (localData) {
        handleMedias(localData);
        return;
    }

    for (const script of window.document.scripts) {
        try {
            const innerHTML = script.innerHTML;
            const data = JSON.parse(innerHTML);
            if (innerHTML.includes('xdt_api__v1__feed__reels_media__connection')) {
                const res = findHighlight(data);
                if (res) {
                    handleMedias(res.edges[0].node);
                    return;
                }
            }
        } catch {
        }
    }

    const videoUrl = sectionNode.querySelector('video')?.getAttribute('src');
    if (videoUrl) {
        final(videoUrl);
        return;
    }

    for (const item of sectionNode.querySelectorAll<HTMLImageElement>('img[referrerpolicy="origin-when-cross-origin"]')) {
        if (item.classList.length > 1) {
            final(item.src);
            return;
        }
    }

    alert('download highlights failed!');
}

export const __highlightsTestApi = {
    createHighlightItemFilename,
    downloadHighlightsAsZip,
    getHighlightBlobExtension,
    getHighlightMediaUrl,
    getHighlightTargets,
    getHighlightsSection,
    resolveCachedHighlightNodes,
    sanitizeZipSegment,
};
