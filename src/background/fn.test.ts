import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProfilePictureUrlFromApiData, saveProfilePicture } from './fn';

describe('background profile picture helpers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('extracts trusted HD profile picture URLs from API payloads', () => {
        expect(getProfilePictureUrlFromApiData({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: 'low.jpg',
                hd_profile_pic_url_info: { url: 'hd-info.jpg' },
            },
        })).toEqual({
            quality: 'high',
            url: 'hd-info.jpg',
            username: 'jkt48.lana.a',
        });

        expect(getProfilePictureUrlFromApiData({
            data: {
                user: {
                    username: 'jkt48.lana.a',
                    profile_pic_url: 'low.jpg',
                    hd_profile_pic_versions: [
                        { height: 150, url: 'small.jpg', width: 150 },
                        { height: 1080, url: 'large.jpg', width: 1080 },
                    ],
                },
            },
        })).toEqual({
            quality: 'high',
            url: 'large.jpg',
            username: 'jkt48.lana.a',
        });
    });

    it('stores HD profile picture URLs in the trusted cache', async () => {
        const set = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({
                        user_profile_hd_pic_url_v2: [],
                        user_profile_pic_url: [],
                    })),
                    set,
                },
            },
        });

        await saveProfilePicture({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: 'low.jpg',
                profile_pic_url_hd: 'hd.jpg',
            },
        });

        expect(set).toHaveBeenCalledWith({
            user_profile_hd_pic_url_v2: [['jkt48.lana.a', 'hd.jpg']],
            user_profile_pic_url: [['jkt48.lana.a', 'hd.jpg']],
        });
    });

    it('keeps fallback profile picture URLs out of the trusted HD cache', async () => {
        const set = vi.fn(async () => undefined);
        vi.stubGlobal('chrome', {
            storage: {
                local: {
                    get: vi.fn(async () => ({
                        user_profile_hd_pic_url_v2: [['other.user', 'other-hd.jpg']],
                        user_profile_pic_url: [],
                    })),
                    set,
                },
            },
        });

        await saveProfilePicture({
            user: {
                username: 'jkt48.lana.a',
                profile_pic_url: 'https://instagram.example/avatar.jpg?stp=dst-jpg_s150x150_tt6&ccb=7-5',
            },
        });

        expect(set).toHaveBeenCalledWith({
            user_profile_hd_pic_url_v2: [['other.user', 'other-hd.jpg']],
            user_profile_pic_url: [['jkt48.lana.a', 'https://instagram.example/avatar.jpg?stp=dst-jpg_s150x150_tt6&ccb=7-5']],
        });
    });
});
