import dayjs from 'dayjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { MediaType } from '../../constants';
import { storageCache } from './storage';
import { getFilenameFromUrl, getMediaName, hashCode } from './filename';

describe('filename utilities', () => {
    beforeEach(() => {
        storageCache.settings = {};
    });

    it('extracts a media name from a URL path', () => {
        expect(getMediaName('https://cdn.example.com/path/media-name.jpg?x=1')).toBe('media-name');
        expect(getMediaName('not a url')).toBe('');
    });

    it('creates stable unsigned hashes', () => {
        expect(hashCode('abc')).toBe(hashCode('abc'));
        expect(hashCode('abc')).not.toBe(hashCode('abcd'));
    });

    it('formats filenames with configured date format and media type', async () => {
        storageCache.settings = {
            setting_enable_datetime_format: true,
            setting_format_datetime: 'YYYY',
            setting_format_filename: '{username}-{type}-{id}-{datetime}',
        };

        await expect(
            getFilenameFromUrl({
                url: 'https://cdn.example.com/fallback.jpg',
                username: 'author',
                datetime: dayjs('2026-04-28T00:00:00Z'),
                id: 'MEDIA',
                type: MediaType.Reel,
            })
        ).resolves.toBe('author-REEL-MEDIA-2026');
    });

    it('uses unix datetime when custom formatting is disabled', async () => {
        storageCache.settings = {
            setting_enable_datetime_format: false,
            setting_format_filename: '{username}-{datetime}-{id}',
        };

        await expect(
            getFilenameFromUrl({
                url: '',
                username: 'author',
                datetime: dayjs(0),
                id: 'MEDIA',
            })
        ).resolves.toBe('author-0-MEDIA');
    });

    it('hashes long ids, appends indexes, falls back to URL media name, and caps length', async () => {
        const longId = 'x'.repeat(60);

        await expect(getFilenameFromUrl({ url: '', id: longId, index: 2 })).resolves.toBe(`${hashCode(longId)}_2`);
        await expect(getFilenameFromUrl({ url: 'https://cdn.example.com/fallback.jpg' })).resolves.toBe('fallback');

        const filename = await getFilenameFromUrl({ url: '', id: 'x'.repeat(200) });
        expect(filename.length).toBeLessThanOrEqual(128);
    });
});
