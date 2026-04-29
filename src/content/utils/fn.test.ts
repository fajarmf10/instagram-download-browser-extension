import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadResource, getAllMediaFromPostId, getImgOrVideoUrl, getUrlFromInfoApi } from './fn';

describe('media info helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '<script>"X-IG-App-ID":"123456"</script>';
        history.pushState({}, '', '/profile/');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('selects video URLs before image URLs', () => {
        expect(getImgOrVideoUrl({ video_versions: [{ url: 'video.mp4' }] })).toBe('video.mp4');
        expect(getImgOrVideoUrl({ image_versions2: { candidates: [{ url: 'image.jpg' }] } })).toBe('image.jpg');
    });

    it('returns null when no shortcode can be found in the article', async () => {
        const article = document.createElement('article');

        await expect(getUrlFromInfoApi(article)).resolves.toBeNull();
    });

    it('finds username-prefixed post links inside articles', async () => {
        const article = document.createElement('article');
        article.innerHTML = '<a href="/jkt48.lana.a/p/PREFIXED/"></a>';
        const fetchMock = vi.fn(async (url: string) => {
            if (url === 'https://www.instagram.com/p/PREFIXED/') {
                return new Response('instagram://media?id=24680');
            }
            return Response.json({
                items: [
                    {
                        id: 'PREFIXED',
                        owner: { username: 'author' },
                        image_versions2: { candidates: [{ url: 'prefixed.jpg' }] },
                    },
                ],
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(getUrlFromInfoApi(article)).resolves.toEqual(expect.objectContaining({
            id: 'PREFIXED',
            url: 'prefixed.jpg',
        }));
        expect(fetchMock).toHaveBeenCalledWith('https://www.instagram.com/p/PREFIXED/');
    });

    it('resolves all carousel media for post shortcodes', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url === 'https://www.instagram.com/p/CODE/') {
                return new Response('instagram://media?id=12345');
            }
            return Response.json({
                items: [
                    {
                        id: 'ORIGIN',
                        taken_at: 1770000000,
                        owner: { username: 'author' },
                        carousel_media: [
                            {
                                id: 'IMG',
                                owner: { username: 'image_author' },
                                image_versions2: { candidates: [{ url: 'image.jpg' }] },
                            },
                            {
                                id: 'VID',
                                video_versions: [{ url: 'video.mp4' }],
                            },
                        ],
                    },
                ],
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(getAllMediaFromPostId('CODE', 'p')).resolves.toEqual([
            expect.objectContaining({ id: 'IMG', owner: 'image_author', url: 'image.jpg' }),
            expect.objectContaining({ id: 'VID', owner: 'author', url: 'video.mp4' }),
        ]);
        expect(fetchMock).toHaveBeenCalledWith('https://www.instagram.com/p/CODE/');
    });

    it('uses reel URLs when resolving reel shortcodes', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url === 'https://www.instagram.com/reel/REELCODE/') {
                return new Response('instagram://media?id=67890');
            }
            return Response.json({
                items: [
                    {
                        id: 'REEL',
                        owner: { username: 'author' },
                        video_versions: [{ url: 'reel.mp4' }],
                    },
                ],
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(getAllMediaFromPostId('REELCODE', 'reel')).resolves.toEqual([
            expect.objectContaining({ id: 'REEL', owner: 'author', url: 'reel.mp4' }),
        ]);
        expect(fetchMock).toHaveBeenCalledWith('https://www.instagram.com/reel/REELCODE/');
    });

    it('does not save text error responses as downloaded media', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('URL signature mismatch', {
            headers: { 'Content-Type': 'text/plain' },
        })));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(downloadResource({
            id: 'avatar',
            url: 'https://cdn.example/avatar.jpg',
        })).resolves.toBe(false);

        expect(document.querySelector('a')).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
        expect((errorSpy.mock.calls[0][0] as Error).message).toBe('Download returned text instead of media: URL signature mismatch');
    });
});
