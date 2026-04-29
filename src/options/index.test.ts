import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
   DEFAULT_DATETIME_FORMAT,
   DEFAULT_FILENAME_FORMAT,
   DEFAULT_PROFILE_BULK_MEDIA_FILTER,
   DEFAULT_PROFILE_BULK_THROTTLE_MS,
} from '../constants';

function renderOptionsFixture() {
   document.body.innerHTML = `
      <input data-setting id="setting_show_open_in_new_tab_icon" type="checkbox" />
      <input data-setting id="setting_profile_bulk_save_as_zip" type="checkbox" />
      <div data-depends-on="setting_profile_bulk_save_as_zip">
         <input data-setting id="setting_profile_bulk_zip_post_folders" type="checkbox" />
      </div>
      <select data-setting id="setting_profile_bulk_media_filter">
         <option value="both">Images and videos</option>
         <option value="images">Images only</option>
         <option value="videos">Videos only</option>
      </select>
      <input data-setting data-setting-type="number" id="setting_profile_bulk_throttle_ms" type="number" />
      <input data-setting id="setting_format_filename" type="text" />
      <input data-setting id="setting_format_datetime" type="text" />
      <div class="status" id="save-status"></div>
   `;
}

async function importOptionsModule(settings: Record<string, any> = {}) {
   const set = vi.fn(async () => undefined);
   vi.stubGlobal('chrome', {
      storage: {
         sync: {
            get: vi.fn(async () => settings),
            set,
         },
      },
   });

   await import('./index');
   await Promise.resolve();
   await Promise.resolve();

   return { set };
}

describe('options page settings', () => {
   beforeEach(() => {
      vi.resetModules();
      renderOptionsFixture();
   });

   afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      document.body.innerHTML = '';
   });

   it('loads saved values and default values into the form', async () => {
      await importOptionsModule({
         setting_show_open_in_new_tab_icon: false,
         setting_profile_bulk_save_as_zip: true,
         setting_profile_bulk_media_filter: 'videos',
      });

      expect(document.querySelector<HTMLInputElement>('#setting_show_open_in_new_tab_icon')!.checked).toBe(false);
      expect(document.querySelector<HTMLInputElement>('#setting_profile_bulk_save_as_zip')!.checked).toBe(true);
      expect(document.querySelector<HTMLSelectElement>('#setting_profile_bulk_media_filter')!.value).toBe('videos');
      expect(document.querySelector<HTMLInputElement>('#setting_profile_bulk_throttle_ms')!.value).toBe(String(DEFAULT_PROFILE_BULK_THROTTLE_MS));
      expect(document.querySelector<HTMLInputElement>('#setting_format_filename')!.value).toBe(DEFAULT_FILENAME_FORMAT);
      expect(document.querySelector<HTMLInputElement>('#setting_format_datetime')!.value).toBe(DEFAULT_DATETIME_FORMAT);
   });

   it('saves checkbox, select, text, and number settings', async () => {
      const { set } = await importOptionsModule({
         setting_profile_bulk_save_as_zip: true,
      });

      const checkbox = document.querySelector<HTMLInputElement>('#setting_show_open_in_new_tab_icon')!;
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      const select = document.querySelector<HTMLSelectElement>('#setting_profile_bulk_media_filter')!;
      select.value = 'images';
      select.dispatchEvent(new Event('change'));

      const throttle = document.querySelector<HTMLInputElement>('#setting_profile_bulk_throttle_ms')!;
      throttle.value = '750';
      throttle.dispatchEvent(new Event('input'));

      const filename = document.querySelector<HTMLInputElement>('#setting_format_filename')!;
      filename.value = '';
      filename.dispatchEvent(new Event('input'));

      await Promise.resolve();

      expect(set).toHaveBeenCalledWith({ setting_show_open_in_new_tab_icon: false });
      expect(set).toHaveBeenCalledWith({ setting_profile_bulk_media_filter: 'images' });
      expect(set).toHaveBeenCalledWith({ setting_profile_bulk_throttle_ms: 750 });
      expect(set).toHaveBeenCalledWith({ setting_format_filename: DEFAULT_FILENAME_FORMAT });
   });

   it('disables dependent fields when their controlling setting is off', async () => {
      await importOptionsModule({
         setting_profile_bulk_save_as_zip: false,
      });

      const dependentField = document.querySelector<HTMLElement>('[data-depends-on="setting_profile_bulk_save_as_zip"]')!;
      const dependentInput = document.querySelector<HTMLInputElement>('#setting_profile_bulk_zip_post_folders')!;

      expect(dependentField.classList.contains('disabled')).toBe(true);
      expect(dependentInput.disabled).toBe(true);
   });

   it('uses configured default constants for profile bulk controls', async () => {
      await importOptionsModule();

      expect(document.querySelector<HTMLSelectElement>('#setting_profile_bulk_media_filter')!.value).toBe(DEFAULT_PROFILE_BULK_MEDIA_FILTER);
      expect(document.querySelector<HTMLInputElement>('#setting_profile_bulk_throttle_ms')!.value).toBe(String(DEFAULT_PROFILE_BULK_THROTTLE_MS));
   });
});
