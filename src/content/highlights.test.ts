import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaType } from '../constants';
import { storageCache } from './utils/storage';
import { __highlightsTestApi, ensureHighlightsBatchDownloadButton } from './highlights';

const {
    createHighlightItemFilename,
    getHighlightBlobExtension,
    getHighlightMediaUrl,
    getHighlightTargets,
    getHighlightsSection,
    resolveCachedHighlightNodes,
    sanitizeZipSegment,
} = __highlightsTestApi;

function makeHighlightNode(overrides: Record<string, any> = {}) {
    return {
        id: 'highlight:123',
        title: 'Beach',
        user: { username: 'author' },
        items: [
            {
                id: 'MEDIA_1',
                pk: 'PK_1',
                taken_at: dayjs('2026-04-28T00:00:00Z').unix(),
                image_versions2: { candidates: [{ url: 'https://cdn.example/image.jpeg' }] },
            },
        ],
        ...overrides,
    } as any;
}

describe('highlights batch helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        storageCache.settings = {};
        history.pushState({}, '', '/jkt48.lana.a/');
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('collects unique profile highlight targets from the header', () => {
        document.body.innerHTML = `
            <main>
                <header>
                    <section>
                        <a aria-label="Lihat sorotan 📸" href="/stories/highlights/123/"></a>
                        <a aria-label="View highlight travel" href="/stories/highlights/456/"></a>
                        <a aria-label="Duplicate" href="/stories/highlights/123/"></a>
                        <a href="/p/POST_1/"></a>
                    </section>
                </header>
            </main>
        `;

        expect(getHighlightTargets()).toEqual([
            expect.objectContaining({ id: '123', title: 'Duplicate' }),
            expect.objectContaining({ id: '456', title: 'travel' }),
        ]);
    });

    it('resolves cached highlight nodes using both prefixed and raw ids', () => {
        const targets = [
            { id: '123', href: '/stories/highlights/123/', title: 'One' },
            { id: '456', href: '/stories/highlights/456/', title: 'Two' },
            { id: '789', href: '/stories/highlights/789/', title: 'Missing' },
        ];
        const prefixedNode = makeHighlightNode({ id: 'highlight:123', title: 'One' });
        const rawNode = makeHighlightNode({ id: '456', title: 'Two' });

        expect(resolveCachedHighlightNodes(targets, [
            ['highlight:123', prefixedNode],
            ['456', rawNode],
        ])).toEqual([
            { target: targets[0], node: prefixedNode },
            { target: targets[1], node: rawNode },
        ]);
    });

    it('chooses video media before image media and normalizes blob extensions', () => {
        const image = makeHighlightNode().items[0];
        const video = {
            ...image,
            video_versions: [{ url: 'https://cdn.example/video.mp4' }],
        };

        storageCache.settings = { setting_format_replace_jpeg_with_jpg: true };

        expect(getHighlightMediaUrl(image)).toBe('https://cdn.example/image.jpeg');
        expect(getHighlightMediaUrl(video)).toBe('https://cdn.example/video.mp4');
        expect(getHighlightBlobExtension(new Blob(['x'], { type: 'image/jpeg' }), image)).toBe('jpg');
        expect(getHighlightBlobExtension(new Blob(['x'], { type: '' }), video as any)).toBe('mp4');
    });

    it('creates safe highlight filenames with indexes', async () => {
        storageCache.settings = {
            setting_enable_datetime_format: true,
            setting_format_datetime: 'YYYYMMDD',
            setting_format_filename: '{username}-{type}-{id}-{datetime}',
            setting_format_replace_jpeg_with_jpg: true,
            setting_format_use_indexing: true,
        };
        const node = makeHighlightNode();

        await expect(createHighlightItemFilename(
            node,
            node.items[0],
            0,
            2,
            new Blob(['x'], { type: 'image/jpeg' })
        )).resolves.toBe(`author-${MediaType.Highlight}-MEDIA_1_1-20260428.jpg`);
    });

    it('inserts the batch highlights button after the highlights section', () => {
        document.body.innerHTML = `
            <main>
                <header>
                    <section class="profile-actions">Actions</section>
                    <section class="highlights">
                        <a aria-label="Lihat sorotan 📸" href="/stories/highlights/123/"></a>
                    </section>
                    <section class="tabs">Tabs</section>
                </header>
            </main>
        `;

        ensureHighlightsBatchDownloadButton(document);

        const highlights = document.querySelector('.highlights')!;
        const wrapper = document.querySelector('.highlights-bulk-download-wrap')!;
        expect(getHighlightsSection()).toBe(highlights);
        expect(highlights.nextElementSibling).toBe(wrapper);
        expect(wrapper.nextElementSibling?.classList.contains('tabs')).toBe(true);
        const button = document.querySelector<HTMLButtonElement>('.highlights-bulk-download-btn')!;
        expect(button.textContent).toBe('Download Highlights');
        expect(button.style.getPropertyValue('background-color')).toBe('rgb(0, 149, 246)');
        expect(button.style.getPropertyValue('color')).toBe('rgb(255, 255, 255)');
    });

    it('sanitizes ZIP path segments', () => {
        expect(sanitizeZipSegment('  bad<>:"/\\|?*\n name  ')).toBe('bad__________ name');
        expect(sanitizeZipSegment('   ')).toBe('highlight');
    });
});
