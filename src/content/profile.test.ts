import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaType } from '../constants';
import { storageCache } from './utils/storage';
import { __profileBulkTestApi, ensureProfileBulkDownloadButton } from './profile';

const {
    createMediaFilename,
    createProfileBulkProgressDialog,
    downloadBlob,
    findProfileActionInsertionTarget,
    findProfileActionRow,
    getProfileAvatarImage,
    getProfileAvatarUrl,
    getHighResolutionProfileAvatarUrlFromApiData,
    getProfileAvatarUrlFromApiData,
    getProfileUserIdFromApiData,
    getBlobExtension,
    getProfileBulkSettings,
    getProfilePostTargets,
    isLikelyLowResolutionAvatarUrl,
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
} = __profileBulkTestApi;

describe('profile bulk helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        storageCache.settings = {};
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('normalizes profile bulk settings with defaults and invalid values', () => {
        storageCache.settings = {
            setting_profile_bulk_include_reels: false,
            setting_profile_bulk_media_filter: 'everything' as any,
            setting_profile_bulk_save_as_zip: false,
            setting_profile_bulk_throttle_ms: -100,
            setting_profile_bulk_zip_post_folders: false,
        };

        expect(getProfileBulkSettings()).toEqual({
            includeReels: false,
            mediaFilter: 'both',
            saveAsZip: false,
            throttleMs: 0,
            zipPostFolders: false,
        });
    });

    it('collects unique post and reel targets from the profile grid', () => {
        document.body.innerHTML = `
            <main>
                <a href="/p/POST_1/"></a>
                <a href="/p/POST_1/"></a>
                <a href="/reel/REEL_1/"></a>
                <a href="/jkt48.lana.a/p/POST_2/"></a>
                <a href="/jkt48.lana.a/reel/REEL_2/"></a>
                <a href="https://www.instagram.com/jkt48.lana.a/p/POST_3/"></a>
                <a href="/tagged/IGNORED/"></a>
                <a href="/stories/highlights/18037572677171967/"></a>
            </main>
        `;

        expect(getProfilePostTargets(true)).toEqual([
            expect.objectContaining({ code: 'POST_1', kind: 'p' }),
            expect.objectContaining({ code: 'REEL_1', kind: 'reel' }),
            expect.objectContaining({ code: 'POST_2', kind: 'p' }),
            expect.objectContaining({ code: 'REEL_2', kind: 'reel' }),
            expect.objectContaining({ code: 'POST_3', kind: 'p' }),
        ]);
        expect(getProfilePostTargets(false)).toEqual([
            expect.objectContaining({ code: 'POST_1', kind: 'p' }),
            expect.objectContaining({ code: 'POST_2', kind: 'p' }),
            expect.objectContaining({ code: 'POST_3', kind: 'p' }),
        ]);
    });

    it('merges targets by kind and shortcode', () => {
        const targets = new Map();

        mergeTargets(targets, [
            { code: 'A', href: 'https://example.com/p/A/', kind: 'p' },
            { code: 'A', href: 'https://example.com/reel/A/', kind: 'reel' },
            { code: 'A', href: 'https://example.com/p/A/?new', kind: 'p' },
        ]);

        expect([...targets.values()]).toEqual([
            { code: 'A', href: 'https://example.com/p/A/?new', kind: 'p' },
            { code: 'A', href: 'https://example.com/reel/A/', kind: 'reel' },
        ]);
    });

    it('updates the bulk button state', () => {
        const button = document.createElement('button');

        setBulkButtonState(button, 'Working', true);
        expect(button.textContent).toBe('Working');
        expect(button.disabled).toBe(true);
        expect(button.style.cursor).toBe('progress');

        setBulkButtonState(button, 'Ready', false);
        expect(button.disabled).toBe(false);
        expect(button.style.cursor).toBe('pointer');
    });

    it('finds the profile avatar image and best available URL from the header intro', () => {
        history.pushState({}, '', '/jkt48.lana.a/');
        document.body.innerHTML = `
            <main>
               <header>
                  <div>
                     <section>
                        <img
                           alt="Foto profil jkt48.lana.a"
                           src="avatar-small.jpg"
                           srcset="avatar-small.jpg 150w, avatar-large.jpg 320w"
                        />
                     </section>
                  </div>
                  <section>
                     <img alt="Gambar cerita sorotan jkt48.lana.a" src="highlight.jpg" />
                  </section>
               </header>
            </main>
        `;

        expect(getProfileAvatarImage()?.getAttribute('src')).toBe('avatar-small.jpg');
        expect(getProfileAvatarUrl()).toContain('avatar-large.jpg');
    });

    it('extracts HD profile avatar URLs from Instagram API payloads', () => {
        const webProfilePayload = {
            data: {
                user: {
                    id: '123456',
                    username: 'jkt48.lana.a',
                    profile_pic_url: 'low.jpg',
                    profile_pic_url_hd: 'hd.jpg',
                },
            },
        };

        expect(getProfileAvatarUrlFromApiData(webProfilePayload)).toBe('hd.jpg');
        expect(getHighResolutionProfileAvatarUrlFromApiData(webProfilePayload)).toBe('hd.jpg');
        expect(getProfileUserIdFromApiData(webProfilePayload)).toBe('123456');

        expect(getProfileAvatarUrlFromApiData({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: 'low.jpg',
                hd_profile_pic_url_info: { url: 'hd-info.jpg' },
            },
        })).toBe('hd-info.jpg');

        expect(getProfileAvatarUrlFromApiData({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: 'low.jpg',
                hd_profile_pic_versions: [
                    { height: 150, url: 'small-version.jpg', width: 150 },
                    { height: 1080, url: 'large-version.jpg', width: 1080 },
                ],
            },
        })).toBe('large-version.jpg');
    });

    it('keeps Instagram signed avatar URLs intact', () => {
        const resizedUrl = 'https://instagram.example/v/t51.82787-19/avatar.jpg?stp=dst-jpg_s150x150_tt6&ccb=7-5';

        expect(isLikelyLowResolutionAvatarUrl('dst-jpg_s150x150_tt6')).toBe(true);
        expect(isLikelyLowResolutionAvatarUrl('dst-jpg_s320x320_tt6')).toBe(false);
        expect(getHighResolutionProfileAvatarUrlFromApiData({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: resizedUrl,
            },
        })).toBeUndefined();
        expect(getProfileAvatarUrlFromApiData({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: resizedUrl,
            },
        })).toBe(resizedUrl);
    });

    it('fetches and caches HD avatars from the profile GraphQL query', async () => {
        history.pushState({}, '', '/jkt48.lana.a/');
        document.body.innerHTML = `
            <script>"X-IG-App-ID":"123456"</script>
            <main>
               <header>
                  <div>
                     <img alt="Foto profil jkt48.lana.a" src="https://cdn.example/s150x150/avatar.jpg" />
                  </div>
               </header>
            </main>
        `;
        const set = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({
                        user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/dst-jpg_s150x150_tt6/avatar.jpg']],
                    })),
                    set,
                },
            },
        });
        const fetchMock = vi.fn(async (url: string) => {
            if (url === 'https://www.instagram.com/jkt48.lana.a/') {
                return new Response('"user_id":"123456"');
            }

            return Response.json({
                data: {
                    user: {
                        username: 'jkt48.lana.a',
                        profile_pic_url: 'https://cdn.example/low.jpg',
                        profile_pic_url_hd: 'https://cdn.example/hd.jpg',
                    },
                },
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(resolveProfileAvatarUrl('jkt48.lana.a')).resolves.toBe('https://cdn.example/hd.jpg');
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://www.instagram.com/jkt48.lana.a/',
            expect.objectContaining({
                credentials: 'include',
            })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('https://www.instagram.com/graphql/query/?doc_id=9539110062771438'),
            expect.objectContaining({
                credentials: 'include',
                headers: expect.objectContaining({ 'X-IG-App-ID': '123456' }),
            })
        );
        expect(set).toHaveBeenCalledWith({
            profile_user_id_by_username: [['jkt48.lana.a', '123456']],
        });
        expect(set).toHaveBeenCalledWith({
            user_profile_hd_pic_url_v2: [['jkt48.lana.a', 'https://cdn.example/hd.jpg']],
            user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/hd.jpg']],
        });
    });

    it('checks the profile GraphQL endpoint before falling back to a low profile avatar URL', async () => {
        history.pushState({}, '', '/jkt48.lana.a/');
        const set = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({
                        user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/dst-jpg_s150x150_tt6/avatar.jpg']],
                    })),
                    set,
                },
            },
        });
        const fetchMock = vi.fn(async (url: string) => {
            if (url === 'https://www.instagram.com/jkt48.lana.a/') {
                return new Response('"user_id":"123456"');
            }

            return Response.json({
                user: {
                    username: 'jkt48.lana.a',
                    hd_profile_pic_url_info: {
                        url: 'https://cdn.example/avatar-original.jpg',
                    },
                },
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(resolveProfileAvatarUrl('jkt48.lana.a')).resolves.toBe('https://cdn.example/avatar-original.jpg');
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('https://www.instagram.com/graphql/query/?doc_id=9539110062771438'),
            expect.any(Object)
        );
        expect(set).toHaveBeenCalledWith({
            user_profile_hd_pic_url_v2: [['jkt48.lana.a', 'https://cdn.example/avatar-original.jpg']],
            user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/avatar-original.jpg']],
        });
    });

    it('keeps trusted cached HD avatars without refetching', async () => {
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({
                        user_profile_hd_pic_url_v2: [['jkt48.lana.a', 'https://cdn.example/avatar-hd.jpg']],
                        user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/avatar-hd.jpg']],
                    })),
                    set: vi.fn(),
                },
            },
        });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        expect(isLikelyLowResolutionAvatarUrl('https://cdn.example/dst-jpg_s150x150_tt6/avatar.jpg')).toBe(true);
        expect(isLikelyLowResolutionAvatarUrl('https://cdn.example/avatar-hd.jpg')).toBe(false);
        await expect(resolveProfileAvatarUrl('jkt48.lana.a')).resolves.toBe('https://cdn.example/avatar-hd.jpg');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not trust legacy avatar cache entries until an HD cache exists', async () => {
        const set = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({
                        user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/ambiguous-avatar.jpg']],
                    })),
                    set,
                },
            },
        });
        const fetchMock = vi.fn(async () => Response.json({
            user: {
                username: 'jkt48.lana.a',
                hd_profile_pic_url_info: {
                    url: 'https://cdn.example/avatar-hd.jpg',
                },
            },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(resolveProfileAvatarUrl('jkt48.lana.a')).resolves.toBe('https://cdn.example/avatar-hd.jpg');
        expect(fetchMock).toHaveBeenCalled();
        expect(set).toHaveBeenCalledWith({
            user_profile_hd_pic_url_v2: [['jkt48.lana.a', 'https://cdn.example/avatar-hd.jpg']],
            user_profile_pic_url: [['jkt48.lana.a', 'https://cdn.example/avatar-hd.jpg']],
        });
    });

    it('finds the visible profile action row from a broad header wrapper', () => {
        document.body.innerHTML = `
            <main>
               <header>
                  <section>
                     <h2>jkt48.lana.a</h2>
                  </section>
               </header>
               <section>
                <section>
                    <div>
                        <div>
                            <button>Diikuti</button>
                            <button>Kirim pesan</button>
                            <div role="button">Add</div>
                        </div>
                    </div>
                </section>
               </section>
            </main>
        `;
        document.querySelectorAll<HTMLElement>('main *').forEach((node) => {
            Object.defineProperty(node, 'offsetParent', { configurable: true, value: document.body });
            vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
                bottom: 40,
                height: 40,
                left: 0,
                right: 300,
                toJSON: () => ({}),
                top: 0,
                width: 300,
                x: 0,
                y: 0,
            });
        });

        expect(findProfileActionRow(document.querySelector('main')!)?.textContent).toContain('Kirim pesan');
    });

    it('places the profile bulk button below the follow/message row, not below stats', () => {
        document.body.innerHTML = `
            <main>
               <section class="stats">
                  <a role="link">51 kiriman</a>
                  <a role="link">456 rb pengikut</a>
                  <a role="link">221 diikuti</a>
               </section>
               <section class="bio">Aurhel Alana</section>
               <section class="actions">
                  <div class="action-row">
                     <button>Diikuti</button>
                     <button>Kirim pesan</button>
                     <div role="button">Add</div>
                  </div>
               </section>
               <section class="highlights">Highlights</section>
            </main>
        `;

        document.querySelectorAll<HTMLElement>('main *').forEach((node) => {
            const isActionsSection = node.classList.contains('actions');
            const isActionRow = node.classList.contains('action-row');
            const isAction = node.matches('.action-row *');
            const isIconAction = node.getAttribute('role') === 'button';
            const width = isIconAction ? 44 : isActionRow || isActionsSection ? 680 : isAction ? 320 : 70;
            const height = isActionsSection ? 52 : isActionRow || isAction ? 44 : 18;
            const rect = {
                bottom: height,
                height,
                left: 0,
                right: width,
                toJSON: () => ({}),
                top: 0,
                width,
                x: 0,
                y: 0,
            };
            vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect);
        });

        const main = document.querySelector<HTMLElement>('main')!;
        const actionRow = document.querySelector<HTMLElement>('.action-row')!;
        const actions = document.querySelector<HTMLElement>('.actions')!;

        ensureProfileBulkDownloadButton(main);

        const foundActionRow = findProfileActionRow(main)!;
        expect(foundActionRow === actionRow || foundActionRow.contains(actionRow)).toBe(true);
        expect(findProfileActionInsertionTarget(foundActionRow, main)).toBe(actions);
        expect(actions.nextElementSibling?.classList.contains('profile-bulk-download-wrap')).toBe(true);
        expect(document.querySelector('.stats')?.nextElementSibling?.classList.contains('bio')).toBe(true);
        const button = document.querySelector<HTMLButtonElement>('.profile-bulk-download-btn')!;
        expect(button.style.getPropertyPriority('width')).toBe('important');
        expect(button.style.getPropertyValue('background-color')).toBe('rgb(0, 149, 246)');
        expect(button.style.getPropertyValue('color')).toBe('rgb(255, 255, 255)');
    });

    it('moves an already inserted bulk button after the full action section', () => {
        document.body.innerHTML = `
            <main>
               <header>
                  <section class="profile-info">Profile info</section>
                  <section class="actions">
                     <div class="action-row">
                        <div><button>Diikuti</button></div>
                        <div><div role="button">Kirim pesan</div></div>
                        <div><div role="button">Akun serupa</div></div>
                     </div>
                  </section>
                  <section class="empty"></section>
                  <section class="highlights">Highlights</section>
               </header>
            </main>
        `;

        document.querySelector('.action-row')?.appendChild(Object.assign(document.createElement('div'), {
            className: 'profile-bulk-download-wrap',
        }));

        document.querySelectorAll<HTMLElement>('main *').forEach((node) => {
            const isAction = node.matches('.action-row, .action-row *');
            const width = node.matches('.action-row') || node.classList.contains('actions')
                ? 700
                : node.textContent?.includes('Kirim') || node.textContent?.includes('Diikuti')
                    ? 220
                    : 44;
            const height = isAction ? 44 : 20;
            vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
                bottom: height,
                height,
                left: 0,
                right: width,
                toJSON: () => ({}),
                top: 0,
                width,
                x: 0,
                y: 0,
            });
        });

        ensureProfileBulkDownloadButton(document.querySelector('main')!);

        const actions = document.querySelector('.actions')!;
        const movedWrapper = document.querySelector('.profile-bulk-download-wrap')!;
        expect(actions.nextElementSibling).toBe(movedWrapper);
        expect(movedWrapper.nextElementSibling?.classList.contains('empty')).toBe(true);
    });

    it('normalizes paths with a trailing slash', () => {
        expect(normalizePath('/profile')).toBe('/profile/');
        expect(normalizePath('/profile/')).toBe('/profile/');
    });

    it('identifies media types and applies media filters', () => {
        const image = { image_versions2: { candidates: [{ url: 'image.jpg' }] } };
        const video = { video_versions: [{ url: 'video.mp4' }] };
        const reel = { product_type: 'clips' };

        expect(isVideoMedia(image)).toBe(false);
        expect(isVideoMedia(video)).toBe(true);
        expect(isVideoMedia(reel)).toBe(true);
        expect(shouldIncludeMedia(image, 'images')).toBe(true);
        expect(shouldIncludeMedia(image, 'videos')).toBe(false);
        expect(shouldIncludeMedia(video, 'videos')).toBe(true);
        expect(shouldIncludeMedia(video, 'both')).toBe(true);
    });

    it('sanitizes zip path segments and falls back for empty names', () => {
        expect(sanitizeZipSegment(' bad<>:"/\\|?*\n name ')).toBe('bad__________ name');
        expect(sanitizeZipSegment('   ')).toBe('media');
    });

    it('chooses blob extensions and respects jpeg replacement', () => {
        storageCache.settings = { setting_format_replace_jpeg_with_jpg: true };
        expect(getBlobExtension(new Blob(['x'], { type: 'image/jpeg' }), false)).toBe('jpg');
        expect(getBlobExtension(new Blob(['x'], { type: '' }), true)).toBe('mp4');
        expect(getBlobExtension(new Blob(['x'], { type: '' }), false)).toBe('jpg');
    });

    it('creates styled dialog buttons', () => {
        const button = makeDialogButton('Stop', 'danger');
        expect(button.type).toBe('button');
        expect(button.textContent).toBe('Stop');
        expect(button.getAttribute('style')).toContain('background:#a13b32');
    });

    it('resolves selected targets from the confirmation dialog', async () => {
        const resultPromise = showProfileBulkConfirmDialog(
            [
                { code: 'POST_1', href: 'https://example.com/p/POST_1/', kind: 'p' },
                { code: 'REEL_1', href: 'https://example.com/reel/REEL_1/', kind: 'reel' },
            ],
            'images'
        );

        const select = document.querySelector('select')!;
        select.value = 'videos';
        document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].checked = false;
        [...document.querySelectorAll('button')].find((button) => button.textContent === 'Download Selected')!.click();

        await expect(resultPromise).resolves.toEqual({
            mediaFilter: 'videos',
            targets: [{ code: 'REEL_1', href: 'https://example.com/reel/REEL_1/', kind: 'reel' }],
        });
    });

    it('returns null when confirmation is cancelled', async () => {
        const resultPromise = showProfileBulkConfirmDialog(
            [{ code: 'POST_1', href: 'https://example.com/p/POST_1/', kind: 'p' }],
            'both'
        );

        [...document.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!.click();

        await expect(resultPromise).resolves.toBeNull();
    });

    it('updates progress dialog state and aborts active requests on stop', () => {
        const dialog = createProfileBulkProgressDialog(10);
        const controller = dialog.createAbortController();

        dialog.setProgress(5, 10);
        dialog.setStatus('Half done');

        expect(document.body.textContent).toContain('Half done');
        expect([...document.querySelectorAll<HTMLDivElement>('div')].some((div) => div.style.width === '50%')).toBe(true);

        [...document.querySelectorAll('button')].find((button) => button.textContent === 'Stop')!.click();

        expect(controller.signal.aborted).toBe(true);
        expect(() => dialog.throwIfStopped()).toThrow('Profile download stopped.');

        dialog.close();
        expect(document.body.textContent).not.toContain('Half done');
    });

    it('waits for throttle while polling pause/stop controls', async () => {
        const controls = {
            throwIfStopped: vi.fn(),
            waitIfPaused: vi.fn().mockResolvedValue(undefined),
        };

        await waitForThrottle(0, controls as any);

        expect(controls.throwIfStopped).not.toHaveBeenCalled();
        expect(controls.waitIfPaused).not.toHaveBeenCalled();
    });

    it('downloads a blob with a temporary anchor and revokes the object URL', () => {
        vi.useFakeTimers();
        const createObjectURL = vi.fn(() => 'blob:profile');
        const revokeObjectURL = vi.fn();
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

        downloadBlob(new Blob(['zip'], { type: 'application/zip' }), 'profile.zip');

        const anchor = document.querySelector('a')!;
        expect(anchor.download).toBe('profile.zip');
        expect(anchor.href).toBe('blob:profile');
        expect(click).toHaveBeenCalled();

        vi.runAllTimers();
        expect(document.querySelector('a')).toBeNull();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:profile');
    });

    it('creates media filenames with type, index, sanitized name, and normalized extension', async () => {
        storageCache.settings = {
            setting_enable_datetime_format: true,
            setting_format_datetime: 'YYYYMMDD',
            setting_format_filename: '{username}-{type}-{id}-{datetime}',
            setting_format_replace_jpeg_with_jpg: true,
            setting_format_use_indexing: true,
        };

        const filename = await createMediaFilename(
            { code: 'POST_1', href: 'https://example.com/p/POST_1/', kind: 'p' },
            {
                id: 'MEDIA:1',
                owner: 'author',
                taken_at: dayjs('2026-04-28T00:00:00Z').unix(),
                url: 'https://example.com/media.jpeg',
            },
            1,
            2,
            new Blob(['image'], { type: 'image/jpeg' })
        );

        expect(filename).toBe(`author-${MediaType.Post}-MEDIA_1_2-20260428.jpg`);
    });
});
