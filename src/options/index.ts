import {
   CONFIG_LIST,
   DEFAULT_DATETIME_FORMAT,
   DEFAULT_FILENAME_FORMAT,
   DEFAULT_PROFILE_BULK_MEDIA_FILTER,
   DEFAULT_PROFILE_BULK_THROTTLE_MS,
} from '../constants';
import './index.scss';

const DEFAULTS: Record<string, string | number | boolean> = {
   setting_format_filename: DEFAULT_FILENAME_FORMAT,
   setting_format_datetime: DEFAULT_DATETIME_FORMAT,
   setting_profile_bulk_media_filter: DEFAULT_PROFILE_BULK_MEDIA_FILTER,
   setting_profile_bulk_throttle_ms: DEFAULT_PROFILE_BULK_THROTTLE_MS,
};

let statusTimer: number | undefined;

function getDefaultValue(input: HTMLInputElement | HTMLSelectElement) {
   if (input.type === 'checkbox') {
      return true;
   }
   return DEFAULTS[input.id] ?? '';
}

function showSavedState() {
   const status = document.getElementById('save-status');
   if (!status) return;

   status.classList.add('visible');
   window.clearTimeout(statusTimer);
   statusTimer = window.setTimeout(() => {
      status.classList.remove('visible');
   }, 1400);
}

function updateDependentFields() {
   document.querySelectorAll<HTMLElement>('[data-depends-on]').forEach((field) => {
      const dependencyId = field.dataset.dependsOn;
      if (!dependencyId) return;

      const dependency = document.getElementById(dependencyId);
      const enabled = dependency instanceof HTMLInputElement ? dependency.checked : true;
      field.classList.toggle('disabled', !enabled);
      field.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => {
         input.disabled = !enabled;
      });
   });
}

async function loadSettings() {
   const settings = await chrome.storage.sync.get(CONFIG_LIST);

   document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((input) => {
      const value = settings[input.id] ?? getDefaultValue(input);
      if (input.type === 'checkbox') {
         (input as HTMLInputElement).checked = Boolean(value);
      } else {
         input.value = String(value);
      }
   });

   updateDependentFields();
}

async function saveSetting(input: HTMLInputElement | HTMLSelectElement) {
   let value: string | number | boolean = input.type === 'checkbox'
      ? input.checked
      : input.value || getDefaultValue(input);

   if (input.dataset.settingType === 'number') {
      const parsedValue = Number(value);
      if (Number.isFinite(parsedValue) && parsedValue >= 0) {
         value = parsedValue;
      } else {
         const fallbackValue = getDefaultValue(input);
         const parsedFallbackValue = Number(fallbackValue);
         value = Number.isFinite(parsedFallbackValue) && parsedFallbackValue >= 0
            ? parsedFallbackValue
            : 0;
      }
   }

   await chrome.storage.sync.set({ [input.id]: value });
   updateDependentFields();
   showSavedState();
}

function setupSettingsForm() {
   document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((input) => {
      const eventName = input.type === 'checkbox' || input instanceof HTMLSelectElement ? 'change' : 'input';
      input.addEventListener(eventName, () => {
         void saveSetting(input);
      });
   });
}

setupSettingsForm();
void loadSettings();
