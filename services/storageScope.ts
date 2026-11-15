import firebaseConfig from '../firebase-applet-config.json';

/**
 * Quản lý không gian lưu trữ biệt lập & xác thực chữ ký ứng dụng (Storage Scoping & Integrity)
 * Đảm bảo dữ liệu local (localStorage, sessionStorage, IndexedDB) được gắn định danh duy nhất
 * theo cấu hình ứng dụng (Firebase Project/App ID) + đường dẫn đầy đủ + chữ ký xác thực gói tin.
 * Ngăn chặn tuyệt đối việc lẫn lộn hoặc đọc nhầm dữ liệu từ các trang web khác có cấu hình tương tự.
 */

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const APP_IDENTITY_SEED = [
  firebaseConfig.projectId || 'local',
  firebaseConfig.appId || 'noapp',
  firebaseConfig.authDomain || 'nodomain',
  'nau_edit_isolated_v2'
].join('|');

export const APP_SIGNATURE = `nau_${fnv1aHash(APP_IDENTITY_SEED)}`;

function getNormalizedLocationParts(): { hostPort: string; cleanPath: string; rawLocation: string } {
  if (typeof window === 'undefined') {
    return { hostPort: 'ssr', cleanPath: '', rawLocation: 'ssr/' };
  }
  const host = (window.location.hostname || 'localhost').toLowerCase();
  const port = window.location.port || '';
  const hostPort = port ? `${host}:${port}` : host;

  let cleanPath = window.location.pathname
    .replace(/\/index\.html?$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const rawLocation = `${hostPort}/${cleanPath}`;
  return { hostPort, cleanPath, rawLocation };
}

export function getLocationHash(): string {
  const { rawLocation } = getNormalizedLocationParts();
  return fnv1aHash(rawLocation);
}

/**
 * Tính toán scope cũ (trước khi nâng cấp) chỉ phục vụ di trú dữ liệu 1 lần an toàn
 */
export function getLegacyAppScope(): string {
  if (typeof window === 'undefined') return 'default';
  try {
    const customScope = localStorage.getItem('custom_app_scope');
    if (customScope && customScope.trim()) {
      return customScope.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const firstSegment = pathname.split('/')[0];
    if (firstSegment && firstSegment.length > 0 && firstSegment !== 'index.html') {
      return firstSegment.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    const host = window.location.hostname.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (host && host !== 'localhost') {
      return host;
    }
    return 'default';
  } catch {
    return 'default';
  }
}

export function getAppScope(): string {
  if (typeof window === 'undefined') return `${APP_SIGNATURE}_ssr`;
  try {
    const { hostPort, cleanPath, rawLocation } = getNormalizedLocationParts();
    const locHash = fnv1aHash(rawLocation);

    // Đọc custom scope gắn riêng với ứng dụng & vị trí hiện tại (không dùng chung key global)
    const customScopedKey = `${APP_SIGNATURE}_custom_scope_${locHash}`;
    const customScope = localStorage.getItem(customScopedKey);
    if (customScope && customScope.trim()) {
      const sanitizedCustom = customScope.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      return `${APP_SIGNATURE}_${sanitizedCustom}_${locHash}`;
    }

    const baseSlugSource = cleanPath || hostPort || 'root';
    const safeSlug = baseSlugSource
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 28);

    return `${APP_SIGNATURE}_${safeSlug}_${locHash}`;
  } catch {
    return `${APP_SIGNATURE}_fallback`;
  }
}

export function getScopedKey(baseKey: string): string {
  const scope = getAppScope();
  return `${scope}__${baseKey}`;
}

interface ScopedEnvelope {
  __v: 2;
  __app: string;
  __loc: string;
  d: string;
}

function wrapEnvelope(value: string): string {
  const envelope: ScopedEnvelope = {
    __v: 2,
    __app: APP_SIGNATURE,
    __loc: getLocationHash(),
    d: value
  };
  return JSON.stringify(envelope);
}

function unwrapEnvelope(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.__v === 2 && typeof parsed.d === 'string') {
      // Xác thực nghiêm ngặt chữ ký ứng dụng và vị trí URL
      if (parsed.__app !== APP_SIGNATURE || parsed.__loc !== getLocationHash()) {
        console.warn('Phát hiện dữ liệu local không khớp chữ ký ứng dụng hiện tại, đã tự động chặn để tránh lẫn dữ liệu.');
        return null;
      }
      return parsed.d;
    }
  } catch {
    // Không phải định dạng envelope v2 hợp lệ -> từ chối đọc để tránh dữ liệu lạ
  }
  return null;
}

let migrationChecked = false;

export function hasLegacyLocalData(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const legacyScope = getLegacyAppScope();
    const prefix = `${legacyScope}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Di trú 1 lần duy nhất các dữ liệu cũ thuộc đúng ứng dụng này sang không gian v2 có chữ ký xác thực.
 * Tuyệt đối KHÔNG đọc các key global chung như 'app_history' hay 'app_single_session' để tránh lẫn dữ liệu từ web khác.
 */
function ensureMigratedOnce(): void {
  if (migrationChecked || typeof window === 'undefined') return;
  migrationChecked = true;

  try {
    const currentScope = getAppScope();
    const markerKey = `${currentScope}___migrated_v2`;
    if (localStorage.getItem(markerKey) === '1') return;

    const legacyScope = getLegacyAppScope();
    const knownKeys = [
      'app_mode',
      'app_single_session',
      'app_history',
      'app_font',
      'edit_shortcuts_v1',
      'edit_shortcuts_enabled'
    ];

    for (const baseKey of knownKeys) {
      const targetKey = `${currentScope}__${baseKey}`;
      if (localStorage.getItem(targetKey) !== null) continue;

      const legacyVal = localStorage.getItem(`${legacyScope}_${baseKey}`);
      if (legacyVal !== null && legacyVal.trim() !== '') {
        // Kiểm tra cấu trúc hợp lệ trước khi di trú đối với session
        if (baseKey === 'app_single_session') {
          try {
            const p = JSON.parse(legacyVal);
            if (!p || p.id !== 'session_main') continue;
          } catch {
            continue;
          }
        }
        try {
          localStorage.setItem(targetKey, wrapEnvelope(legacyVal));
        } catch {
          // ignore quota error during migration
        }
      }
    }

    // Di trú các bản nháp chuyển truyện (${legacyScope}_novel_draft_*)
    const legacyDraftPrefix = `${legacyScope}_novel_draft_`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(legacyDraftPrefix)) {
        const suffix = k.slice(`${legacyScope}_`.length);
        const targetKey = `${currentScope}__${suffix}`;
        if (localStorage.getItem(targetKey) === null) {
          const val = localStorage.getItem(k);
          if (val !== null) {
            try {
              localStorage.setItem(targetKey, wrapEnvelope(val));
            } catch {}
          }
        }
      }
    }

    // Di trú các tùy chọn nhỏ của ứng dụng nếu chưa có trong scope mới
    const smallPrefKeys = [
      'autoSync_vocab',
      'autoSync_world',
      'app_omitted_particles',
      'app_omit_particles_enabled'
    ];
    for (const prefKey of smallPrefKeys) {
      const targetKey = `${currentScope}__${prefKey}`;
      if (localStorage.getItem(targetKey) !== null) continue;
      const val = localStorage.getItem(`${legacyScope}_${prefKey}`) ?? localStorage.getItem(prefKey);
      if (val !== null) {
        if (prefKey === 'autoSync_vocab' || prefKey === 'autoSync_world' || prefKey === 'app_omit_particles_enabled') {
          if (val !== 'true' && val !== 'false') continue;
        }
        if (prefKey === 'app_omitted_particles') {
          try {
            const parsed = JSON.parse(val);
            if (!Array.isArray(parsed)) continue;
          } catch {
            continue;
          }
        }
        try {
          localStorage.setItem(targetKey, wrapEnvelope(val));
        } catch {}
      }
    }

    localStorage.setItem(markerKey, '1');
  } catch (e) {
    console.warn('Lỗi di trú dữ liệu sang không gian bảo mật mới:', e);
  }
}

export function getScopedStorageItem(baseKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    ensureMigratedOnce();
    const scopedKey = getScopedKey(baseKey);
    const raw = localStorage.getItem(scopedKey);
    return unwrapEnvelope(raw);
  } catch (e) {
    console.warn(`Lỗi đọc scoped storage cho key: ${baseKey}`, e);
    return null;
  }
}

export function setScopedStorageItem(baseKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  ensureMigratedOnce();
  const scopePrefix = `${getAppScope()}__`;
  const scopedKey = getScopedKey(baseKey);
  const wrapped = wrapEnvelope(value);

  try {
    localStorage.setItem(scopedKey, wrapped);
  } catch (e: any) {
    console.warn(`Lỗi ghi scoped storage cho key: ${baseKey}`, e);
    // Nếu bộ nhớ localStorage bị đầy (QuotaExceededError):
    // CHỈ dọn dẹp các key nháp/lịch sử thuộc CHÍNH phạm vi của web này, tuyệt đối không đụng key web khác
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k &&
            k.startsWith(scopePrefix) &&
            k !== scopedKey &&
            (k.includes('app_history') || k.includes('novel_draft_'))
          ) {
            localStorage.removeItem(k);
            break;
          }
        }
        localStorage.setItem(scopedKey, wrapped);
        return;
      } catch (_) {}
    }
    throw e;
  }
}

export function removeScopedStorageItem(baseKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const scopedKey = getScopedKey(baseKey);
    localStorage.removeItem(scopedKey);
  } catch (e) {
    console.error(`Lỗi xóa scoped storage cho key: ${baseKey}`, e);
  }
}

export function getScopedSessionItem(baseKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const scopedKey = getScopedKey(baseKey);
    return unwrapEnvelope(sessionStorage.getItem(scopedKey));
  } catch {
    return null;
  }
}

export function setScopedSessionItem(baseKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const scopedKey = getScopedKey(baseKey);
    sessionStorage.setItem(scopedKey, wrapEnvelope(value));
  } catch {
    // ignore
  }
}

export function getScopedDbName(): string {
  const scope = getAppScope();
  return `AppDB_${scope}`;
}

export function getLegacyDbName(): string {
  const legacyScope = getLegacyAppScope();
  return `AppDB_${legacyScope}`;
}
