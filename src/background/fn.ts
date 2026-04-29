import type { Stories } from '../types/stories';
import type { Highlight } from '../types/highlights';
import type { Reels } from '../types/reels';
import type { ProfileReel } from '../types/profileReel';

const PROFILE_AVATAR_CACHE_KEY = 'user_profile_pic_url';
const PROFILE_AVATAR_HD_CACHE_KEY = 'user_profile_hd_pic_url_v2';

function isLikelyLowResolutionAvatarUrl(url: string) {
    const match = url.match(/(?:^|[/?&_=.-])s(\d{2,4})x(\d{2,4})(?:[_&/.-]|$)/);
    if (!match) return false;
    return Math.max(Number(match[1]), Number(match[2])) <= 150;
}

function getLargestAvatarVersionUrl(versions?: any[]) {
    if (!Array.isArray(versions)) return undefined;
    return [...versions]
        .filter((version) => typeof version?.url === 'string')
        .sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0))[0]?.url;
}

function findProfilePictureUser(obj: any): any {
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
        const result = findProfilePictureUser(value);
        if (result) return result;
    }
}

export function getProfilePictureUrlFromApiData(jsonData: Record<string, any>) {
    const user = findProfilePictureUser(jsonData);
    if (!user?.username) return undefined;

    const highResolutionUrl = [
        user?.profile_pic_url_hd,
        user?.hd_profile_pic_url_info?.url,
        getLargestAvatarVersionUrl(user?.hd_profile_pic_versions),
    ]
        .filter((url): url is string => typeof url === 'string')
        .find((url) => !isLikelyLowResolutionAvatarUrl(url));

    if (highResolutionUrl) {
        return { quality: 'high' as const, url: highResolutionUrl, username: user.username as string };
    }

    const fallbackUrl = user?.profile_pic_url;
    if (typeof fallbackUrl === 'string') {
        return { quality: 'fallback' as const, url: fallbackUrl, username: user.username as string };
    }
}

export async function saveProfilePicture(jsonData: Record<string, any>) {
    const result = getProfilePictureUrlFromApiData(jsonData);
    if (!result) return;

    const avatarStorage = await chrome.storage.local.get([
        PROFILE_AVATAR_HD_CACHE_KEY,
        PROFILE_AVATAR_CACHE_KEY,
    ]);
    const newMap = new Map(avatarStorage[PROFILE_AVATAR_CACHE_KEY] || []);
    const hdMap = new Map(avatarStorage[PROFILE_AVATAR_HD_CACHE_KEY] || []);
    newMap.set(result.username, result.url);
    if (result.quality === 'high') {
        hdMap.set(result.username, result.url);
    }
    await chrome.storage.local.set({
        [PROFILE_AVATAR_CACHE_KEY]: [...newMap],
        [PROFILE_AVATAR_HD_CACHE_KEY]: [...hdMap],
    });
}

// save highlights data from json
export async function saveHighlights(jsonData: Record<string, any>) {
    if (Array.isArray(jsonData.data?.xdt_api__v1__feed__reels_media__connection?.edges)) {
        const data = (jsonData as Highlight.Root).data.xdt_api__v1__feed__reels_media__connection.edges.map((i) => i.node);
        const { highlights_data } = await chrome.storage.local.get(['highlights_data']);
        const newMap = new Map(highlights_data);
        data.forEach((i) => newMap.set(i.id, i));
        await chrome.storage.local.set({ highlights_data: [...newMap] });

        //? The presentation stories in home page top url is /stories/{username} now
        //? before was /stories/highlights/{pk}
        //? so we need to save the data to stories_reels_media
        saveStoriesToLocal(data);
    }
}

// save reels data from json
export async function saveReels(jsonData: Record<string, any>) {
    if (Array.isArray(jsonData.data?.xdt_api__v1__clips__home__connection_v2?.edges)) {
        const data = (jsonData as Reels.Root).data.xdt_api__v1__clips__home__connection_v2.edges.map((i) => i.node.media);
        const { reels_edges_data } = await chrome.storage.local.get(['reels_edges_data']);
        const newMap = new Map(reels_edges_data);
        data.forEach((i) => newMap.set(i.code, i));
        await chrome.storage.local.set({ reels_edges_data: [...newMap] });
    }
}

export async function saveProfileReel(jsonData: Record<string, any>) {
    if (Array.isArray(jsonData.data?.xdt_api__v1__clips__user__connection_v2?.edges)) {
        const data = (jsonData as ProfileReel.Root).data.xdt_api__v1__clips__user__connection_v2.edges.map((i) => i.node.media);
        const { profile_reels_edges_data } = await chrome.storage.local.get(['profile_reels_edges_data']);
        const newMap = new Map(profile_reels_edges_data);
        data.forEach((i) => newMap.set(i.code, i));
        await chrome.storage.local.set({ profile_reels_edges_data: [...newMap] });
    }
}

// save stories data from json
export async function saveStories(jsonData: Record<string, any>) {
    if (Array.isArray(jsonData.data?.xdt_api__v1__feed__reels_media?.reels_media)) {
        const data = (jsonData as Stories.Root).data.xdt_api__v1__feed__reels_media.reels_media;
        saveStoriesToLocal(data);
    }
}

export async function saveStoriesToLocal(data: Stories.ReelsMedum[]) {
    const { stories_reels_media } = await chrome.storage.local.get(['stories_reels_media']);
    const newMap = new Map(stories_reels_media);
    data.forEach((i) => newMap.set(i.id, i));
    await chrome.storage.local.set({ stories_reels_media: [...newMap] });
}

export function findValueByKey(obj: Record<string, any>, key: string): any {
    for (const property in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, property)) {
            if (property === key) {
                return obj[property];
            } else if (typeof obj[property] === 'object') {
                const result = findValueByKey(obj[property], key);
                if (result !== undefined) {
                    return result;
                }
            }
        }
    }
}
