import React, { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex items-center justify-center sm:gap-1.5 text-[10px] font-bold text-[#3E2723] bg-[#FFECB3] hover:bg-[#FFE082] h-8 w-8 sm:w-auto sm:px-2.5 rounded-full border border-[#FFE082] transition-colors shrink-0 cursor-pointer shadow-xs"
        title="Cài thành ứng dụng để mở nhanh và edit offline"
      >
        <Download size={12} />
        <span className="hidden sm:inline">Cài app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center justify-center sm:gap-1.5 text-[10px] font-medium text-[#FFECB3] hover:text-white bg-[#5D4037]/50 hover:bg-[#5D4037] h-8 w-8 sm:w-auto sm:px-2.5 rounded-full border border-[#FFECB3]/25 transition-colors shrink-0 cursor-pointer"
          title="Thêm vào màn hình chính để dùng offline"
        >
          <Download size={12} />
          <span className="hidden sm:inline">Cài app</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#FFFDF7] border border-[#D7CCC8] p-5 shadow-2xl text-[#3E2723]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold">Thêm vào màn hình chính (iOS)</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-full text-[#8D6E63] hover:bg-[#EFE5D9]"
                >
                  <X size={15} />
                </button>
              </div>
              <p className="text-xs text-[#5D4037] leading-relaxed">
                1. Bấm nút <strong>Chia sẻ (Share)</strong> ở thanh công cụ Safari.<br />
                2. Chọn <strong>Thêm vào MH chính (Add to Home Screen)</strong>.<br />
                Sau khi cài, các chương đã tải và chế độ <strong>Beta</strong> có thể edit ngoại tuyến.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-xl bg-[#4E342E] py-2 text-xs font-bold text-[#FFECB3] hover:bg-[#3E2723]"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-3 left-3 z-[90] flex items-center gap-2 rounded-lg bg-[#4E342E] border border-[#FFECB3]/40 px-3 py-1.5 text-[11px] font-semibold text-[#FFECB3] shadow-lg">
      <WifiOff size={13} className="text-amber-300 shrink-0" />
      <span>Đang ngoại tuyến — Chỉnh sửa được lưu trên máy &amp; tự đồng bộ khi có mạng</span>
    </div>
  );
};
