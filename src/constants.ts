export const CONFIG_LIST = [
    'setting_show_open_in_new_tab_icon',
    'setting_show_zip_download_icon',
    'setting_enable_threads',
    'setting_enable_video_controls',
    'setting_enable_explore_video_clickthrough',
    'setting_format_replace_jpeg_with_jpg',
    'setting_format_use_indexing',
    'setting_enable_datetime_format',
    'setting_format_filename',
    'setting_format_datetime',
    'setting_profile_bulk_media_filter',
    'setting_profile_bulk_save_as_zip',
    'setting_profile_bulk_zip_post_folders',
    'setting_profile_bulk_include_reels',
    'setting_profile_bulk_throttle_ms',
];

export enum MediaType {
    Post = 'POST',
    Story = 'STOR',
    Reel = 'REEL',
    Highlight = 'HGHT',
    Threads = 'THRD',
}

export const DEFAULT_FILENAME_FORMAT = `{username}-{id}-{datetime}`;
export const DEFAULT_DATETIME_FORMAT = 'YYYYMMDD_HHmmss';
export const DEFAULT_PROFILE_BULK_MEDIA_FILTER = 'both';
export const DEFAULT_PROFILE_BULK_THROTTLE_MS = 500;

export const EXTENSION_ID = 'oejjpeobjicdpgaijialfpfcbdnanajk';

export const CLASS_CUSTOM_BUTTON = 'custom-btn';


export const MESSAGE_OPEN_URL = "open_url"
export const MESSAGE_ZIP_DOWNLOAD = "zip_download"
