/**
 * Quản lý không gian lưu trữ biệt lập (Storage Scoping)
 * Đảm bảo khi bạn copy repo hoặc chạy nhiều trang web trên cùng một tài khoản GitHub Pages (ví dụ cucnau.github.io/edit/ và cucnau.github.io/repo2/),
 * dữ liệu của mỗi trang web (bảng đối chiếu, kho từ, nhân vật, lịch sử, cài đặt...) sẽ hoàn toàn tách biệt, không bao giờ bị lẫn lộn vào nhau.
 */

export function getAppScope(): string {
  if (typeof window === 'undefined') return 'default';
  try {
    // 1. Nếu người dùng tự đặt tên không gian riêng trong LocalStorage
    const customScope = localStorage.getItem('custom_app_scope');
    if (customScope && customScope.trim()) {
      return customScope.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    // 2. Tự động nhận diện theo thư mục đường dẫn (pathname)
    // Ví dụ: https://cucnau.github.io/edit/ -> scope là "edit"
    // Ví dụ: https://cucnau.github.io/truyen2/ -> scope là "truyen2"
    const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const firstSegment = pathname.split('/')[0];
    if (firstSegment && firstSegment.length > 0 && firstSegment !== 'index.html') {
      return firstSegment.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    // 3. Nếu chạy ở root (như trên Vercel hoặc localhost), lấy theo hostname
    const host = window.location.hostname.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (host && host !== 'localhost') {
      return host;
    }

    return 'default';
  } catch {
    return 'default';
  }
}

export function getScopedKey(baseKey: string): string {
  const scope = getAppScope();
  return `${scope}_${baseKey}`;
}

export function getScopedStorageItem(baseKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const scope = getAppScope();
    const scopedKey = getScopedKey(baseKey);

    // 1. Phục hồi thông minh cho Lịch Sử Dịch (app_history):
    // Quét tìm bản ghi có dữ liệu thực sự (không lấy mảng rỗng "[]") từ cả scoped key lẫn các key lịch sử trước đó
    if (baseKey === 'app_history') {
      const candidates = [
        localStorage.getItem(scopedKey),
        localStorage.getItem(`${scope}_chiVietHistory`),
        localStorage.getItem('app_history'),
        localStorage.getItem('chiVietHistory')
      ];
      for (const cand of candidates) {
        if (cand && cand.trim() && cand !== '[]') {
          try {
            const parsed = JSON.parse(cand);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return cand;
            }
          } catch (_) {}
        }
      }
      return '[]';
    }

    // 2. Phục hồi thông minh cho Phiên Làm Việc (app_single_session):
    // Ưu tiên tìm bản có nội dung thực sự (inputText hoặc result) từ các key trước đó
    if (baseKey === 'app_single_session') {
      const candidates = [
        localStorage.getItem(scopedKey),
        localStorage.getItem(`${scope}_chiVietSingleSession`),
        localStorage.getItem('app_single_session'),
        localStorage.getItem('chiVietSingleSession')
      ];
      for (const cand of candidates) {
        if (cand && cand.trim()) {
          try {
            const parsed = JSON.parse(cand);
            if (parsed && (parsed.inputText || parsed.result)) {
              return cand;
            }
          } catch (_) {}
        }
      }
      for (const cand of candidates) {
        if (cand && cand.trim()) return cand;
      }
    }

    const val = localStorage.getItem(scopedKey);
    if (val !== null) return val;

    // Đọc fallback từ key chuẩn chưa prefix
    const standardVal = localStorage.getItem(baseKey);
    if (standardVal !== null) return standardVal;

    return null;
  } catch (e) {
    console.warn(`Lỗi đọc scoped storage cho key: ${baseKey}`, e);
    return null;
  }
}

export function setScopedStorageItem(baseKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const scopedKey = getScopedKey(baseKey);
    localStorage.setItem(scopedKey, value);
  } catch (e) {
    console.error(`Lỗi ghi scoped storage cho key: ${baseKey}`, e);
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

export function getScopedDbName(): string {
  const scope = getAppScope();
  return `AppDB_${scope}`;
}
