
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AppStatus, TranslationSession, HistoryItem, TranslationResponse, Chapter, CustomTerm, Character, Relationship, TranslationSegment, Novel } from './types';
import { translateText } from './services/geminiService';
import { alignTextWithAI } from './services/geminiService';
import { exportToExcel } from './services/excelService';
import {
  getNovels,
  createNovel,
  renameNovel,
  listenToNovelsRealtime,
  getChaptersFromCloud,
  getAllChaptersFromCloud,
  listenToAllChaptersRealtime,
  saveChapterToCloud,
  bulkSaveChaptersToCloud,
  deleteChapterFromCloud,
  clearNovelChaptersFromCloud,
  syncFirestoreData,
  getDocCollabSessionFromCloud,
  listenToDocCollabSession,
  saveDocCollabFullSession,
  updateDocCollabFields,
  updateDocCollabSegment,
  updateDocCollabCompleted,
  mergeCollabIntoChapterSnapshot,
  DocCollabCloudData,
  getAllUserCustomTermsFromCloud,
  deleteFirestoreDoc
} from './services/firestoreService';
import { auth } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { vietphraseEngine } from './services/vietphraseService';
import { db } from './services/db'; // Import db service
import { TranslationOutput } from './components/TranslationOutput';
import { DictionarySidebar } from './components/DictionarySidebar';
import { WorldInfoPanel } from './components/WorldInfoPanel';
import { HistoryModal } from './components/HistoryModal'; 
import { ChapterArchiveModal } from './components/ChapterArchiveModal';
import { ShortcutModal } from './components/ShortcutModal';
import { AuthPanel } from './components/AuthPanel';
import { NovelSelector } from './components/NovelSelector';
import { HomeScreen } from './components/HomeScreen';
import { BookOpen, Loader2, Eraser, Quote, Layout, History, AlertTriangle, Layers, PenLine, FolderOpen, Keyboard, X, Users, RefreshCw, Smartphone, Laptop, AlignJustify, Type, RotateCcw, ArrowLeft } from 'lucide-react';
import { checkAndApplyShortcut, getStoredShortcuts, isShortcutsEnabled, syncShortcutsFromCloud } from './services/shortcutService';
import { convertToSmartQuotes, cleanTextArtifacts } from './services/textUtils';
import { getScopedStorageItem, setScopedStorageItem, getScopedSessionItem, setScopedSessionItem } from './services/storageScope';

const EXAMPLE_TEXT = "路遥知马力，日久见人心。";

// --- ERROR BOUNDARY COMPONENT ---
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  state: any;
  props: any;
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
       return (
         <div className="h-screen flex flex-col items-center justify-center bg-[#F5E6D3] text-[#3E2723] p-8 text-center font-sans">
            <div className="bg-red-100 p-4 rounded-full mb-4">
                <AlertTriangle size={48} className="text-red-600" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Rất tiếc, đã xảy ra lỗi!</h1>
            <p className="mb-6 opacity-80 max-w-md">Ứng dụng gặp sự cố bất ngờ. Vui lòng tải lại trang hoặc kiểm tra lại kết nối.</p>
            
            <div className="bg-white p-4 rounded-lg shadow-sm border border-red-200 text-left overflow-auto max-w-lg w-full max-h-60 mb-6 relative">
                <div className="absolute top-2 right-2 text-[10px] text-red-400 font-bold uppercase tracking-wider">Chi tiết lỗi</div>
                <code className="text-xs text-red-800 font-mono whitespace-pre-wrap block pt-4">{this.state.error?.toString()}</code>
            </div>

            <button 
                onClick={() => window.location.reload()} 
                className="bg-[#3E2723] text-white px-6 py-2.5 rounded-lg hover:bg-[#4E342E] font-bold shadow-lg transition-all active:scale-95"
            >
               Tải lại ứng dụng
            </button>
         </div>
       )
    }
    return this.props.children;
  }
}

// Hàm căn lề bản dịch (nhất là GG Translate thường xuyên gộp đoạn)
const alignTranslation = (rawLines: string[], translation: string): string[] => {
    if (!translation.trim()) return new Array(rawLines.length).fill("");
    
    const tLines = translation.split('\n').map(l => l.trim()).filter(l => l);
    const rLinesWithIndices = rawLines.map((l, i) => ({ text: l.trim(), index: i }));
    const validRLines = rLinesWithIndices.filter(l => l.text);
    
    const result = new Array(rawLines.length).fill("");
    if (validRLines.length === 0 || tLines.length === 0) return result;
    
    // TRƯỜNG HỢP 1: Bản dịch dán vào đã có cấu trúc phân dòng tốt (số dòng dịch dán vào nhiều hoặc gần bằng số dòng raw)
    // Ta ưu tiên map 1-1 theo dòng gốc để giữ nguyên vẹn cấu trúc xuống dòng cực chuẩn của người dùng dán vào
    if (tLines.length === validRLines.length || Math.abs(tLines.length - validRLines.length) <= 1 && tLines.length >= validRLines.length * 0.9) {
        let tIdx = 0;
        validRLines.forEach((rLine, i) => {
            if (tIdx < tLines.length) {
                // Nếu đây là dòng cuối cùng, gom hết các dòng dịch dán vào còn thừa (nếu có)
                if (i === validRLines.length - 1) {
                    result[rLine.index] = tLines.slice(tIdx).join(" ");
                } else {
                    result[rLine.index] = tLines[tIdx++];
                }
            }
        });
        return result;
    }
    
    // TRƯỜNG HỢP 2: Bản dịch thực sự bị dính cục (ví dụ chỉ có 1 hoặc 2 dòng dính liền, trong khi raw có nhiều dòng)
    // Lúc này mới áp dụng thuật toán tách câu thông minh dựa trên tỷ lệ độ dài ký tự của dòng gốc
    const translationText = tLines.join(" ");
    // Tách thành các câu bằng regex mạnh mẽ hỗ trợ cả dấu câu dịch tiếng Trung lẫn tiếng Việt
    const sentences = translationText.match(/[^.!?。！？]+(?:[.!?。！？]+(?:['"”\] \t])*?|(?=\s*$))/g) || [translationText];
    const cleanSentences = sentences.map(s => s.trim()).filter(s => s);
    
    if (cleanSentences.length === 0) return result;
    
    // Tính toán trọng số dựa trên độ dài ký tự thô của dòng gốc (bỏ dấu cách và dấu câu Trung)
    const rawCleanLengths = validRLines.map(r => {
        const cleanText = r.text.replace(/[\s\p{P}]/gu, '');
        return cleanText.length || 1;
    });
    
    const totalRawLength = rawCleanLengths.reduce((sum, l) => sum + l, 0) || 1;
    const targetProportions = rawCleanLengths.map(l => l / totalRawLength);
    
    // Tổng chiều dài ký tự tiếng Việt đã dịch
    const totalTransLength = cleanSentences.reduce((sum, s) => sum + s.length, 0) || 1;
    
    let sentenceIdx = 0;
    
    validRLines.forEach((rLine, i) => {
        // Dòng cuối cùng nhận toàn bộ những câu còn lại
        if (i === validRLines.length - 1) {
            const assigned = cleanSentences.slice(sentenceIdx);
            result[rLine.index] = assigned.join(" ");
            return;
        }
        
        const lineTarget = totalTransLength * targetProportions[i];
        const lineSentences: string[] = [];
        let currentLineLength = 0;
        
        while (sentenceIdx < cleanSentences.length) {
            const sentence = cleanSentences[sentenceIdx];
            
            // Bắt buộc lấy ít nhất 1 câu đầu tiên cho dòng này để tránh bị trống dòng vô lý
            if (lineSentences.length === 0) {
                lineSentences.push(sentence);
                currentLineLength += sentence.length;
                sentenceIdx++;
                continue;
            }
            
            // RÀO CHẮN BẢO VỆ: Đảm bảo chừa đủ số câu tối thiểu cho các dòng còn lại tiếp theo
            const remainingSentencesAfterThis = cleanSentences.length - sentenceIdx - 1;
            const remainingLinesAfterThis = validRLines.length - 1 - i;
            if (remainingSentencesAfterThis < remainingLinesAfterThis) {
                break;
            }
            
            // Tính khoảng cách tới độ dài mục tiêu để quyết định xem có nên lấy câu này không
            const distWithout = Math.abs(lineTarget - currentLineLength);
            const distWith = Math.abs(lineTarget - (currentLineLength + sentence.length));
            
            if (distWith > distWithout) {
                // cân bằng tối ưu hơn nếu dừng trước khi lấy câu này
                break;
            }
            
            lineSentences.push(sentence);
            currentLineLength += sentence.length;
            sentenceIdx++;
        }
        
        result[rLine.index] = lineSentences.join(" ");
    });
    
    return result;
};

const sanitizeResult = (result: TranslationResponse | null): TranslationResponse | null => {
    if (!result) return null;
    try {
        return {
            ...result,
            segments: (result.segments || []).map(s => ({
                source: (s.source || "").trim(),
                natural: convertToSmartQuotes(cleanTextArtifacts(s.natural || "").replace(/\n+$/, "")),
                quick: cleanTextArtifacts(s.quick || "").replace(/\n+$/, ""),
                deepl: (s.deepl || "").trim().replace(/\n+$/, "")
            })),
            naturalTranslation: convertToSmartQuotes(cleanTextArtifacts(result.naturalTranslation || "").replace(/\n+$/, "")),
            quickTrans: cleanTextArtifacts(result.quickTrans || "").replace(/\n+$/, ""),
            deeplTranslation: (result.deeplTranslation || "").trim().replace(/\n+$/, ""),
            vocabulary: result.vocabulary || []
        };
    } catch (e) {
        console.warn("Sanitize failed, keeping original", e);
        return result;
    }
};

const createNewSession = (docKey?: string, novelId?: string): TranslationSession => ({
  id: 'session_main',
  docKey: docKey || `draft_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
  name: `Edit`,
  inputText: '',
  deeplText: '',
  preEditedText: '',
  status: AppStatus.IDLE,
  result: null,
  resultUpdatedAt: 0,
  error: null,
  modelId: 'auto',
  currentHistoryId: undefined,
  currentChapterId: undefined,
  customTerms: [],
  sheetUrl: '',
  currentNovelId: novelId,
  characters: [],    
  relationships: [], 
  notes: '',
  completedSegments: []
});

function AppContent() {
  // --- STATE ---
  const [activeView, setActiveView] = useState<'home' | 'editor'>(() => {
    try {
      const savedTabView = getScopedSessionItem('tab_active_view');
      return savedTabView === 'editor' ? 'editor' : 'home';
    } catch {
      return 'home';
    }
  });

  useEffect(() => {
    try {
      setScopedSessionItem('tab_active_view', activeView);
    } catch {}
  }, [activeView]);

  const [novels, setNovels] = useState<Novel[]>(() => {
    try {
      const cached = getScopedStorageItem('app_novels_cache');
      const parsed = cached ? JSON.parse(cached) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [homeNovelFilter, setHomeNovelFilter] = useState<string>('');
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() => !!auth.currentUser);
  const [isLoadingHomeData, setIsLoadingHomeData] = useState<boolean>(false);

  const [mode, setMode] = useState<'edit' | 'beta'>(() => {
    try {
      const savedMode = getScopedStorageItem('app_mode');
      return (savedMode === 'beta' || savedMode === 'edit') ? savedMode : 'edit';
    } catch (e) {
      return 'edit';
    }
  });

  useEffect(() => {
    try {
      setScopedStorageItem('app_mode', mode);
    } catch (e) {}
  }, [mode]);

  const [session, setSession] = useState<TranslationSession>(() => {
    try {
      const savedTabSnapshot = getScopedSessionItem('tab_session_snapshot');
      if (savedTabSnapshot) {
        const parsed = JSON.parse(savedTabSnapshot);
        const sanitizedRes = sanitizeResult(parsed.result);
        const hasSegments = Boolean(sanitizedRes?.segments && sanitizedRes.segments.length > 0);
        return {
          ...createNewSession(parsed.docKey, parsed.currentNovelId),
          ...parsed,
          status: hasSegments ? AppStatus.SUCCESS : (parsed.status === AppStatus.ERROR ? AppStatus.ERROR : AppStatus.IDLE),
          customTerms: [],
          result: sanitizedRes
        };
      }
      return createNewSession();
    } catch (e) {
      console.error("Failed to load session", e);
      return createNewSession();
    }
  });

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = getScopedStorageItem('app_history');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showChapters, setShowChapters] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showMobileDict, setShowMobileDict] = useState(false);
  const [showMobileWorld, setShowMobileWorld] = useState(false);
  const [shortcuts, setShortcuts] = useState(() => getStoredShortcuts(session.currentNovelId));
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => isShortcutsEnabled());
  const [vpLoaded, setVpLoaded] = useState(false);
  const [currentFont, setCurrentFont] = useState<string>(() => {
    return getScopedStorageItem('app_font') || 'default';
  });

  useEffect(() => {
    document.body.setAttribute('data-app-font', currentFont);
    setScopedStorageItem('app_font', currentFont);
    
    // Phát sự kiện để tất cả các ô textarea trong bảng tự động tính lại chiều cao (tránh khoảng trống thừa)
    window.dispatchEvent(new Event('app_font_changed'));
    window.dispatchEvent(new Event('resize'));
    const t1 = setTimeout(() => {
      window.dispatchEvent(new Event('app_font_changed'));
      window.dispatchEvent(new Event('resize'));
    }, 50);
    const t2 = setTimeout(() => {
      window.dispatchEvent(new Event('app_font_changed'));
      window.dispatchEvent(new Event('resize'));
    }, 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [currentFont]);

  useEffect(() => {
    setShortcuts(getStoredShortcuts(session.currentNovelId));
    if (session.currentNovelId) {
      syncShortcutsFromCloud(session.currentNovelId).then(cloudList => {
        if (cloudList) setShortcuts(cloudList);
      }).catch(console.warn);
    }
  }, [session.currentNovelId]);

  // Khi đổi truyện (novelId): Tải chính xác Nhân vật, Xưng hô & Từ vựng của đúng truyện này từ Cloud
  useEffect(() => {
    const novelId = session.currentNovelId;
    if (!novelId || !auth.currentUser) return;

    let isMounted = true;
    (async () => {
      try {
        const [cloudChars, cloudRels, cloudVocab] = await Promise.all([
          syncFirestoreData<Character>('char', novelId, 'GET').catch(() => [] as Character[]),
          syncFirestoreData<Relationship>('rel', novelId, 'GET').catch(() => [] as Relationship[]),
          syncFirestoreData<CustomTerm>('vocab', novelId, 'GET').catch(() => [] as CustomTerm[])
        ]);

        if (!isMounted) return;

        setSession(prev => {
          if (prev.currentNovelId !== novelId) return prev;

          // Lọc giữ lại dữ liệu của các truyện khác
          const otherChars = (prev.characters || []).filter(c => c.novelId && c.novelId !== novelId);
          const otherRels = (prev.relationships || []).filter(r => r.novelId && r.novelId !== novelId);
          const otherTerms = (prev.customTerms || []).filter(t => t.novelId && t.novelId !== novelId);

          const mergedChars = [...otherChars, ...cloudChars.map(c => ({ ...c, novelId }))];
          const mergedRels = [...otherRels, ...cloudRels.map(r => ({ ...r, novelId }))];
          const mergedTerms = [...otherTerms, ...cloudVocab.map(t => ({ ...t, novelId }))];

          // Cập nhật CustomMap chuẩn xác cho Vietphrase của truyện này
          const customMap = new Map<string, string>();
          cloudChars.forEach(c => {
            if (c.chineseName && c.vietName) customMap.set(c.chineseName.trim(), c.vietName.trim());
          });
          cloudVocab.forEach(t => {
            if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
          });
          vietphraseEngine.setCustomMap(customMap);
          vietphraseEngine.notify();

          let updatedResult = prev.result;
          if (prev.result?.segments && prev.result.segments.length > 0) {
            const updatedSegments = prev.result.segments.map(seg => ({
              ...seg,
              quick: seg.source ? (vietphraseEngine.translate(seg.source, customMap) || seg.quick || '') : (seg.quick || '')
            }));
            updatedResult = {
              ...prev.result,
              segments: updatedSegments,
              quickTrans: updatedSegments.map(s => s.quick).join('\n')
            };
          }

          return {
            ...prev,
            characters: mergedChars,
            relationships: mergedRels,
            customTerms: mergedTerms,
            result: updatedResult
          };
        });
      } catch (err) {
        console.warn("Lỗi tải dữ liệu truyện từ Cloud:", err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [session.currentNovelId]);

  useEffect(() => {
    const handleUpdate = () => {
      setShortcuts(getStoredShortcuts(session.currentNovelId));
      setShortcutsEnabled(isShortcutsEnabled());
    };
    window.addEventListener('shortcuts_updated', handleUpdate);
    window.addEventListener('shortcuts_toggle', handleUpdate);
    return () => {
      window.removeEventListener('shortcuts_updated', handleUpdate);
      window.removeEventListener('shortcuts_toggle', handleUpdate);
    };
  }, [session.currentNovelId]);
  
  // Undo/Redo/Focus states
  const [undoStack, setUndoStack] = useState<string[][]>([]);
  const [redoStack, setRedoStack] = useState<string[][]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // --- REAL-TIME DEVICE IDENTIFIER & LEVEL 1 + LEVEL 2 SYNC STATE ---
  const deviceId = useMemo(() => {
    try {
      let id = getScopedSessionItem('app_device_id');
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
        setScopedSessionItem('app_device_id', id);
      }
      return id;
    } catch (e) {
      return 'dev_' + Math.random().toString(36).substring(2, 9);
    }
  }, []);

  const [realtimeNotify, setRealtimeNotify] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;

  // Level 2 timestamp tracking (per-document, per-segment, per-field)
  const localResultResetAtRef = useRef<number>(0);
  const localSegmentTsRef = useRef<Record<number, number>>({});
  const localCompletedTsRef = useRef<Record<number, number>>({});
  const localFieldTsRef = useRef<Record<string, number>>({});
  const fieldSyncTimerRef = useRef<any>(null);
  const pendingFieldsRef = useRef<{ inputText?: string; deeplText?: string; preEditedText?: string }>({});
  const chapterSaveTimerRef = useRef<any>(null);

  const activeDocKey = useMemo(() => {
    if (activeView !== 'editor') return '';
    return session.currentChapterId || session.docKey || '';
  }, [activeView, session.currentChapterId, session.docKey]);

  const showSyncToast = (msg = "Đã đồng bộ từ thiết bị khác") => {
    setRealtimeNotify(msg);
    setTimeout(() => setRealtimeNotify(null), 2400);
  };

  // Đồng bộ chương hiện tại vào IndexedDB & Cloud dựa trên trạng thái đã hợp nhất mới nhất
  const flushChapterProgressNow = async (
    overrideResult?: TranslationResponse,
    overrideCompleted?: number[],
    overrideFields?: { inputText?: string; deeplText?: string; preEditedText?: string }
  ) => {
    if (chapterSaveTimerRef.current) {
      clearTimeout(chapterSaveTimerRef.current);
      chapterSaveTimerRef.current = null;
    }
    const curr = sessionRef.current;
    const chapId = curr.currentChapterId;
    if (!chapId) return;

    const targetChap = chaptersRef.current.find(c => c.id === chapId);
    if (!targetChap) return;

    const resToSave = overrideResult || curr.result || targetChap.result || {
      naturalTranslation: '',
      quickTrans: '',
      sinoVietnamese: '',
      deeplTranslation: '',
      segments: [],
      vocabulary: []
    };

    const compToSave = overrideCompleted !== undefined ? overrideCompleted : (curr.completedSegments || []);
    const now = Date.now();
    const updatedChap: Chapter = {
      ...targetChap,
      inputText: overrideFields?.inputText !== undefined ? overrideFields.inputText : curr.inputText,
      deeplText: overrideFields?.deeplText !== undefined ? overrideFields.deeplText : curr.deeplText,
      preEditedText: overrideFields?.preEditedText !== undefined ? overrideFields.preEditedText : curr.preEditedText,
      result: resToSave,
      completedSegments: compToSave,
      resultUpdatedAt: localResultResetAtRef.current || targetChap.resultUpdatedAt || now,
      timestamp: now
    };

    setChapters(prev => prev.map(c => (c.id === chapId ? updatedChap : c)));
    await db.saveChapter(updatedChap).catch(console.warn);
    await saveChapterToCloud(updatedChap).catch(console.warn);
  };

  const scheduleChapterProgressSave = () => {
    if (!sessionRef.current.currentChapterId) return;
    if (chapterSaveTimerRef.current) clearTimeout(chapterSaveTimerRef.current);
    chapterSaveTimerRef.current = setTimeout(() => {
      flushChapterProgressNow().catch(console.warn);
    }, 1200);
  };

  // Áp dụng cập nhật Level 2 từ thiết bị/tab khác đang mở CÙNG 1 chương/tài liệu
  const applyIncomingDocCollab = (incoming: DocCollabCloudData, showNotify = true) => {
    if (!incoming) return;
    const curr = sessionRef.current;
    const expectedKey = curr.currentChapterId || curr.docKey || '';
    if (incoming.docKey && expectedKey && incoming.docKey !== expectedKey) return;

    const incomingResetTs = incoming.resultUpdatedAt || 0;
    let changed = false;

    // Trường hợp 1: Thiết bị khác vừa phân tích lại, xóa đoạn, hoặc Undo/Redo toàn bộ
    if (incoming.result && incomingResetTs > localResultResetAtRef.current) {
      const sanitizedBase = sanitizeResult(incoming.result);
      if (sanitizedBase) {
        localResultResetAtRef.current = incomingResetTs;
        localSegmentTsRef.current = {};
        localCompletedTsRef.current = {};

        const mergedSegments = sanitizedBase.segments.map(s => ({ ...s }));
        const segEdits = incoming.segmentEdits || {};
        Object.keys(segEdits).forEach(key => {
          const idx = parseInt(key, 10);
          const entry = segEdits[key];
          if (!isNaN(idx) && idx >= 0 && idx < mergedSegments.length && entry && (entry.updatedAt || 0) >= incomingResetTs) {
            if (entry.source !== undefined) mergedSegments[idx].source = entry.source;
            if (entry.natural !== undefined) mergedSegments[idx].natural = entry.natural;
            if (entry.quick !== undefined) mergedSegments[idx].quick = entry.quick;
            if (entry.deepl !== undefined) mergedSegments[idx].deepl = entry.deepl;
            localSegmentTsRef.current[idx] = entry.updatedAt;
          }
        });

        const completedSet = new Set(incoming.completedSegments || []);
        const compEdits = incoming.completedEdits || {};
        Object.keys(compEdits).forEach(key => {
          const idx = parseInt(key, 10);
          const entry = compEdits[key];
          if (!isNaN(idx) && entry && (entry.updatedAt || 0) >= incomingResetTs) {
            if (entry.done) completedSet.add(idx);
            else completedSet.delete(idx);
            localCompletedTsRef.current[idx] = entry.updatedAt;
          }
        });

        const nextResult: TranslationResponse = {
          ...sanitizedBase,
          segments: mergedSegments,
          naturalTranslation: mergedSegments.map(s => s.natural || '').join('\n'),
          quickTrans: mergedSegments.map(s => s.quick || '').join('\n'),
          deeplTranslation: mergedSegments.map(s => s.deepl || '').join('\n')
        };

        setSession(prev => ({
          ...prev,
          currentNovelId: incoming.novelId || prev.currentNovelId,
          inputText: incoming.inputText !== undefined ? incoming.inputText : prev.inputText,
          deeplText: incoming.deeplText !== undefined ? incoming.deeplText : prev.deeplText,
          preEditedText: incoming.preEditedText !== undefined ? incoming.preEditedText : prev.preEditedText,
          status: mergedSegments.length > 0 ? AppStatus.SUCCESS : (incoming.status === AppStatus.ERROR ? AppStatus.ERROR : AppStatus.IDLE),
          result: nextResult,
          resultUpdatedAt: incomingResetTs,
          completedSegments: Array.from(completedSet),
          currentChapterId: incoming.currentChapterId || prev.currentChapterId,
          currentHistoryId: incoming.currentHistoryId || prev.currentHistoryId
        }));
        if (showNotify) showSyncToast();
        return;
      }
    }

    // Trường hợp 2 (Google Docs Level 2): Chỉ hòa trộn các đoạn văn, checkbox và ô nhập liệu mới hơn theo từng khóa
    setSession(prev => {
      let nextInput = prev.inputText;
      let nextDeepl = prev.deeplText;
      let nextPreEdit = prev.preEditedText || '';
      const fTs = incoming.fieldsUpdatedAt || {};

      if (fTs.inputText && fTs.inputText > (localFieldTsRef.current.inputText || 0) && fTs.inputText >= localResultResetAtRef.current && incoming.inputText !== undefined && incoming.inputText !== prev.inputText) {
        nextInput = incoming.inputText;
        localFieldTsRef.current.inputText = fTs.inputText;
        changed = true;
      }
      if (fTs.deeplText && fTs.deeplText > (localFieldTsRef.current.deeplText || 0) && fTs.deeplText >= localResultResetAtRef.current && incoming.deeplText !== undefined && incoming.deeplText !== prev.deeplText) {
        nextDeepl = incoming.deeplText;
        localFieldTsRef.current.deeplText = fTs.deeplText;
        changed = true;
      }
      if (fTs.preEditedText && fTs.preEditedText > (localFieldTsRef.current.preEditedText || 0) && fTs.preEditedText >= localResultResetAtRef.current && incoming.preEditedText !== undefined && incoming.preEditedText !== (prev.preEditedText || '')) {
        nextPreEdit = incoming.preEditedText;
        localFieldTsRef.current.preEditedText = fTs.preEditedText;
        changed = true;
      }

      let nextResult = prev.result;
      if (prev.result?.segments && incoming.segmentEdits) {
        let segModified = false;
        const updatedSegments = prev.result.segments.map(s => ({ ...s }));
        Object.keys(incoming.segmentEdits).forEach(key => {
          const idx = parseInt(key, 10);
          const entry = incoming.segmentEdits![key];
          if (isNaN(idx) || idx < 0 || idx >= updatedSegments.length || !entry) return;
          const localTs = localSegmentTsRef.current[idx] || 0;
          if ((entry.updatedAt || 0) > localTs && (entry.updatedAt || 0) >= localResultResetAtRef.current) {
            if (entry.source !== undefined && updatedSegments[idx].source !== entry.source) {
              updatedSegments[idx].source = entry.source;
              segModified = true;
            }
            if (entry.natural !== undefined) {
              const cleanedNatural = convertToSmartQuotes(cleanTextArtifacts(entry.natural).replace(/\n+$/, ""));
              if (updatedSegments[idx].natural !== cleanedNatural) {
                updatedSegments[idx].natural = cleanedNatural;
                segModified = true;
              }
            }
            if (entry.quick !== undefined && updatedSegments[idx].quick !== entry.quick) {
              updatedSegments[idx].quick = entry.quick;
              segModified = true;
            }
            if (entry.deepl !== undefined && updatedSegments[idx].deepl !== entry.deepl) {
              updatedSegments[idx].deepl = entry.deepl;
              segModified = true;
            }
            localSegmentTsRef.current[idx] = entry.updatedAt;
          }
        });

        if (segModified) {
          changed = true;
          nextResult = {
            ...prev.result,
            segments: updatedSegments,
            naturalTranslation: updatedSegments.map(s => s.natural || '').join('\n'),
            quickTrans: updatedSegments.map(s => s.quick || '').join('\n'),
            deeplTranslation: updatedSegments.map(s => s.deepl || '').join('\n')
          };
        }
      }

      let nextCompleted = prev.completedSegments || [];
      if (incoming.completedEdits) {
        const compSet = new Set(nextCompleted);
        let compChanged = false;
        Object.keys(incoming.completedEdits).forEach(key => {
          const idx = parseInt(key, 10);
          const entry = incoming.completedEdits![key];
          if (isNaN(idx) || !entry) return;
          const localTs = localCompletedTsRef.current[idx] || 0;
          if ((entry.updatedAt || 0) > localTs && (entry.updatedAt || 0) >= localResultResetAtRef.current) {
            if (entry.done && !compSet.has(idx)) {
              compSet.add(idx);
              compChanged = true;
            } else if (!entry.done && compSet.has(idx)) {
              compSet.delete(idx);
              compChanged = true;
            }
            localCompletedTsRef.current[idx] = entry.updatedAt;
          }
        });
        if (compChanged) {
          changed = true;
          nextCompleted = Array.from(compSet);
        }
      }

      if (!changed) return prev;
      return {
        ...prev,
        inputText: nextInput,
        deeplText: nextDeepl,
        preEditedText: nextPreEdit,
        result: nextResult,
        completedSegments: nextCompleted
      };
    });

    if (changed && showNotify) {
      showSyncToast();
    }
  };

  // 1. LEVEL 1 & LEVEL 2: CHỈ LẮNG NGHE TÀI LIỆU/CHƯƠNG ĐANG MỞ TRÊN TAB NÀY
  useEffect(() => {
    if (activeView !== 'editor' || !activeDocKey) return;

    let unsubscribeDoc: (() => void) | null = null;
    let isCancelled = false;

    const setupDocSync = async () => {
      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = null;
      }
      const user = auth.currentUser;
      if (!user || !activeDocKey) return;

      const cloudDoc = await getDocCollabSessionFromCloud(activeDocKey);
      if (isCancelled) return;

      if (cloudDoc) {
        applyIncomingDocCollab(cloudDoc, false);
      } else if (sessionRef.current.result?.segments?.length) {
        // Khởi tạo phiên cộng tác trên cloud cho chương đã có nội dung
        saveDocCollabFullSession(activeDocKey, {
          novelId: sessionRef.current.currentNovelId,
          deviceId,
          currentChapterId: sessionRef.current.currentChapterId,
          currentHistoryId: sessionRef.current.currentHistoryId,
          inputText: sessionRef.current.inputText,
          deeplText: sessionRef.current.deeplText,
          preEditedText: sessionRef.current.preEditedText || '',
          status: sessionRef.current.status,
          completedSegments: sessionRef.current.completedSegments || [],
          result: sessionRef.current.result,
          resultUpdatedAt: localResultResetAtRef.current || Date.now()
        }).catch(console.warn);
      }

      if (isCancelled) return;
      unsubscribeDoc = listenToDocCollabSession(activeDocKey, deviceId, (incoming) => {
        applyIncomingDocCollab(incoming, true);
      });
    };

    setupDocSync();
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (user) setupDocSync();
      else if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = null;
      }
    });

    return () => {
      isCancelled = true;
      authUnsub();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, [activeView, activeDocKey, deviceId]);

  // 2. LẮNG NGHE TOÀN BỘ DANH SÁCH TRUYỆN & CHƯƠNG REALTIME CHO MÀN HÌNH CHÍNH VÀ KHO CHƯƠNG
  useEffect(() => {
    let unsubNovels: (() => void) | null = null;
    let unsubAllChapters: (() => void) | null = null;

    const setupGlobalLibrarySync = async () => {
      const user = auth.currentUser;
      setIsSignedIn(!!user);
      if (unsubNovels) { unsubNovels(); unsubNovels = null; }
      if (unsubAllChapters) { unsubAllChapters(); unsubAllChapters = null; }

      if (!user) return;
      setIsLoadingHomeData(true);

      try {
        const [initialNovels, cloudChapters, localChapters] = await Promise.all([
          getNovels().catch(() => [] as Novel[]),
          getAllChaptersFromCloud().catch(() => [] as Chapter[]),
          db.getAllChapters().catch(() => [] as Chapter[])
        ]);

        if (initialNovels.length > 0) {
          setNovels(initialNovels);
          try { setScopedStorageItem('app_novels_cache', JSON.stringify(initialNovels)); } catch {}
          setSession(prev => prev.currentNovelId ? prev : { ...prev, currentNovelId: initialNovels[0].id });
        }

        // Đẩy các chương cục bộ chưa có trên đám mây lên Cloud
        const cloudIds = new Set((cloudChapters || []).map(c => c.id));
        const unsyncedLocal = (localChapters || []).filter(c => c.id && !cloudIds.has(c.id));
        if (unsyncedLocal.length > 0) {
          await bulkSaveChaptersToCloud(unsyncedLocal).catch(console.warn);
        }

        const mergedMap = new Map<string, Chapter>();
        (localChapters || []).forEach(c => { if (c?.id) mergedMap.set(c.id, c); });
        (cloudChapters || []).forEach(c => { if (c?.id) mergedMap.set(c.id, c); });
        const initialMerged = Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setChapters(initialMerged);
        initialMerged.forEach(c => db.saveChapter(c).catch(console.warn));
      } finally {
        setIsLoadingHomeData(false);
      }

      unsubNovels = listenToNovelsRealtime((liveNovels) => {
        setNovels(liveNovels);
        try { setScopedStorageItem('app_novels_cache', JSON.stringify(liveNovels)); } catch {}
        if (liveNovels.length > 0) {
          setSession(prev => prev.currentNovelId ? prev : { ...prev, currentNovelId: liveNovels[0].id });
        }
      });

      unsubAllChapters = listenToAllChaptersRealtime((liveChapters) => {
        setChapters(liveChapters);
        liveChapters.forEach(c => db.saveChapter(c).catch(console.warn));
      });
    };

    const authUnsub = onAuthStateChanged(auth, (user) => {
      setIsSignedIn(!!user);
      if (user) {
        setupGlobalLibrarySync();
      } else {
        if (unsubNovels) { unsubNovels(); unsubNovels = null; }
        if (unsubAllChapters) { unsubAllChapters(); unsubAllChapters = null; }
      }
    });

    return () => {
      authUnsub();
      if (unsubNovels) unsubNovels();
      if (unsubAllChapters) unsubAllChapters();
    };
  }, []);

  // --- REFS ---
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- COMPUTED ---
  const segmentCount = session.inputText.trim() ? session.inputText.split(/\n/).length : 0;

  const novelArchiveChapters = useMemo(() => {
    return chapters.filter(c => !session.currentNovelId || c.novelId === session.currentNovelId || !c.novelId);
  }, [chapters, session.currentNovelId]);

  const activeNovelChaptersCount = useMemo(() => {
    return novelArchiveChapters.filter(c => !c.deletedAt).length;
  }, [novelArchiveChapters]);

  const currentNovelChapters = useMemo(() => {
    return chapters.filter(c => !c.deletedAt && (!session.currentNovelId || c.novelId === session.currentNovelId || !c.novelId));
  }, [chapters, session.currentNovelId]);

  const matchedDraft = useMemo(() => {
    if (session.result?.segments && session.result.segments.length > 0) return null;
    const inputTrim = session.inputText.trim();
    if (!inputTrim) return null;

    const matchedChapter = chapters.find(c => !c.deletedAt && c.inputText && c.inputText.trim() === inputTrim && c.result?.segments && c.result.segments.length > 0);
    if (matchedChapter) {
      return { type: 'chapter' as const, name: matchedChapter.name, data: matchedChapter };
    }

    const matchedHistory = history.find(h => h.sourceText && h.sourceText.trim() === inputTrim && h.result?.segments && h.result.segments.length > 0);
    if (matchedHistory) {
      return { type: 'history' as const, name: new Date(matchedHistory.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }), data: matchedHistory };
    }

    return null;
  }, [session.inputText, session.result, chapters, history]);

  // --- EFFECTS ---
  // Khởi tạo Vietphrase Engine & Tự động phục hồi toàn diện Từ vựng từ IndexedDB và Cloud Firestore
  useEffect(() => {
    (async () => {
      await vietphraseEngine.init();
      console.log("Vietphrase Engine Initialized");
      setVpLoaded(true);
    })();
       
    // 1. Tải toàn bộ từ vựng đã lưu trong IndexedDB cục bộ
    db.getAllCustomTerms().then(terms => {
      if (terms && terms.length > 0) {
        setSession(prev => {
          const map = new Map<string, CustomTerm>();
          (prev.customTerms || []).forEach(t => map.set(t.id, t));
          terms.forEach(t => map.set(t.id, t));
          return { ...prev, customTerms: Array.from(map.values()) };
        });
      }
    });

    db.getAllChapters().then(savedChapters => {
      if (savedChapters && savedChapters.length > 0) {
        setChapters(prev => prev.length > 0 ? prev : savedChapters);
      }
    });

    db.getHistory().then(savedDbHistory => {
      if (savedDbHistory && Array.isArray(savedDbHistory) && savedDbHistory.length > 0) {
        setHistory(prev => {
          const combinedMap = new Map<string, HistoryItem>();
          savedDbHistory.forEach(item => { if (item?.id) combinedMap.set(item.id, item); });
          prev.forEach(item => { if (item?.id && !combinedMap.has(item.id)) combinedMap.set(item.id, item); });
          return Array.from(combinedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        });
      }
    });

    // 2. Chỉ tự động phục hồi từ vựng từ Cloud nếu thiết bị này chưa có dữ liệu nào (thiết bị mới hoàn toàn)
    const restoreCloudTerms = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const localTerms = await db.getAllCustomTerms();
        if (!localTerms || localTerms.length === 0) {
          const cloudTerms = await getAllUserCustomTermsFromCloud();
          if (cloudTerms && cloudTerms.length > 0) {
            setSession(prev => ({
              ...prev,
              customTerms: cloudTerms
            }));
            db.bulkSaveCustomTerms(cloudTerms).catch(console.error);
          }
        }
      } catch (e) {
        console.warn("Lỗi tự động phục hồi từ vựng từ Cloud:", e);
      }
    };

    restoreCloudTerms();
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) restoreCloudTerms();
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  // Lưu snapshot phiên làm việc riêng cho từng tab vào sessionStorage (không ghi đè giữa các tab)
  useEffect(() => {
    const sessionToSave = { ...session, customTerms: [], characters: [], relationships: [] };
    try {
      setScopedSessionItem('tab_session_snapshot', JSON.stringify(sessionToSave));
    } catch {
      try {
        setScopedSessionItem('tab_session_snapshot', JSON.stringify({
          id: session.id,
          docKey: session.docKey,
          currentChapterId: session.currentChapterId,
          currentNovelId: session.currentNovelId,
          status: session.status
        }));
      } catch {}
    }
  }, [session]);

  // Lưu History song song vào IndexedDB & localStorage
  useEffect(() => {
    if (history.length > 0) {
      // 1. Luôn lưu trọn vẹn history vào IndexedDB
      db.saveHistory(history).catch(console.warn);
    }

    try {
        setScopedStorageItem('app_history', JSON.stringify(history));
    } catch (e) {
        try {
            const leanHistory = history.slice(0, 15).map((item, idx) => {
                if (idx >= 2 && item.result) {
                    return {
                        ...item,
                        result: {
                            ...item.result,
                            segments: []
                        }
                    };
                }
                return item;
            });
            setScopedStorageItem('app_history', JSON.stringify(leanHistory));
        } catch (innerE) {
            try {
                const superLeanHistory = history.slice(0, 5).map(item => ({
                    ...item,
                    result: item.result ? {
                        ...item.result,
                        segments: []
                    } : null
                }));
                setScopedStorageItem('app_history', JSON.stringify(superLeanHistory));
            } catch (lastE) {
                console.warn("Storage Quota Exceeded for History in LocalStorage");
            }
        }
    }
  }, [history]);

  // Reset undo/redo stacks when loading a new chapter or starting a new translation
  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [session.currentHistoryId, session.inputText]);

  // Keyboard shortcuts for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            e.preventDefault();
            handleRedo();
          } else {
            e.preventDefault();
            handleUndo();
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, session.result]);

  // Tự động chuyển đổi dấu ngoặc kép thẳng "" sang dấu ngoặc kép cong thông minh “”
  useEffect(() => {
    const handleGlobalSmartQuotes = (e: KeyboardEvent) => {
      if (e.key === '"') {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        const isTextarea = target.tagName === 'TEXTAREA';
        const isTextInput = target.tagName === 'INPUT' && (!((target as HTMLInputElement).type) || ['text', 'search', 'url'].includes((target as HTMLInputElement).type));

        if (isTextarea || isTextInput) {
          const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
          const start = inputEl.selectionStart ?? 0;
          const end = inputEl.selectionEnd ?? 0;
          const val = inputEl.value || '';

          let replacement = '';
          if (start !== end) {
            const selectedText = val.substring(start, end);
            replacement = `“${selectedText}”`;
          } else {
            if (start === 0) {
              replacement = '“';
            } else {
              const prevChar = val[start - 1];
              if (/[\s\(\[\{<«\n\r\t“]/.test(prevChar)) {
                replacement = '“';
              } else {
                replacement = '”';
              }
            }
          }

          e.preventDefault();

          // Dùng execCommand để giữ lịch sử Undo (Ctrl+Z) mượt mà
          let inserted = false;
          try {
            inserted = document.execCommand('insertText', false, replacement);
          } catch (err) {
            inserted = false;
          }

          if (!inserted) {
            inputEl.setRangeText(replacement, start, end, 'end');
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalSmartQuotes, true);
    return () => window.removeEventListener('keydown', handleGlobalSmartQuotes, true);
  }, []);

  const pushFullDocCollabToCloud = (customUpdates?: Partial<TranslationSession>, docKeyOverride?: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const current = { ...sessionRef.current, ...customUpdates };
    const docKey = docKeyOverride || current.currentChapterId || current.docKey || '';
    if (!docKey) return;
    const now = Date.now();
    localResultResetAtRef.current = now;
    localSegmentTsRef.current = {};
    localCompletedTsRef.current = {};
    localFieldTsRef.current = { inputText: now, deeplText: now, preEditedText: now };

    saveDocCollabFullSession(docKey, {
      novelId: current.currentNovelId,
      deviceId,
      currentChapterId: current.currentChapterId,
      currentHistoryId: current.currentHistoryId,
      inputText: current.inputText,
      deeplText: current.deeplText,
      preEditedText: current.preEditedText || '',
      status: current.status,
      completedSegments: current.completedSegments || [],
      result: current.result,
      resultUpdatedAt: now
    });
  };

  const updateSession = (updates: Partial<TranslationSession>, syncToCloud = true) => {
    setSession(prev => ({ ...prev, ...updates }));
    if (!syncToCloud || activeView !== 'editor') return;

    const docKey = updates.currentChapterId || sessionRef.current.currentChapterId || updates.docKey || sessionRef.current.docKey || '';
    if (!docKey) return;

    const fieldKeys: ('inputText' | 'deeplText' | 'preEditedText')[] = ['inputText', 'deeplText', 'preEditedText'];
    let hasFieldChange = false;
    const now = Date.now();

    fieldKeys.forEach(fk => {
      if (updates[fk] !== undefined) {
        pendingFieldsRef.current[fk] = updates[fk];
        localFieldTsRef.current[fk] = now;
        hasFieldChange = true;
      }
    });

    if (hasFieldChange) {
      if (sessionRef.current.currentChapterId) {
        scheduleChapterProgressSave();
      }
      if (auth.currentUser) {
        if (fieldSyncTimerRef.current) clearTimeout(fieldSyncTimerRef.current);
        fieldSyncTimerRef.current = setTimeout(() => {
          const toPush = { ...pendingFieldsRef.current };
          pendingFieldsRef.current = {};
          const curr = sessionRef.current;
          const targetKey = curr.currentChapterId || curr.docKey || '';
          if (targetKey && Object.keys(toPush).length > 0) {
            updateDocCollabFields(targetKey, {
              novelId: curr.currentNovelId,
              deviceId,
              currentChapterId: curr.currentChapterId,
              ...toPush,
              now: Date.now()
            }).catch(console.warn);
          }
        }, 450);
      }
    }
  };

  // Quản lý cập nhật từ vựng an toàn tuyệt đối - đảm bảo 100% ghi đè chuẩn xác lên Vietphrase
  const handleUpdateTerms = (novelTerms: CustomTerm[]) => {
    try {
      const currentId = session.currentNovelId || '';
      // Giữ lại tất cả các từ của truyện khác
      const otherNovelsTerms = (session.customTerms || []).filter(t => t.novelId && t.novelId !== currentId);

      // Cho truyện hiện tại: dùng danh sách novelTerms truyền vào, gán chuẩn novelId
      const novelTermsMap = new Map<string, CustomTerm>();
      novelTerms.forEach(t => {
        if (t.term?.trim()) {
          const cleanKey = t.term.trim();
          novelTermsMap.set(cleanKey, { ...t, term: cleanKey, meaning: (t.meaning || '').trim(), novelId: t.novelId || currentId });
        }
      });

      const merged = [...otherNovelsTerms, ...Array.from(novelTermsMap.values())];

      // Tạo CustomMap chuẩn xác cho Vietphrase: nhân vật nạp trước, từ vựng nạp sau đè lên
      const currentChars = (session.characters || []).filter(c => !currentId || c.novelId === currentId);
      const thisNovelTerms = merged.filter(t => !currentId || t.novelId === currentId);
      const customMap = new Map<string, string>();
      currentChars.forEach(c => {
        if (c.chineseName && c.vietName) customMap.set(c.chineseName.trim(), c.vietName.trim());
      });
      thisNovelTerms.forEach(t => {
        if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
      });

      // Cập nhật ngay vào engine
      vietphraseEngine.setCustomMap(customMap);
      vietphraseEngine.notify();

      let updatedResult = session.result;
      if (session.result?.segments && session.result.segments.length > 0) {
        const updatedSegments = session.result.segments.map(seg => ({
          ...seg,
          quick: seg.source ? (vietphraseEngine.translate(seg.source, customMap) || seg.quick || '') : (seg.quick || '')
        }));
        updatedResult = {
          ...session.result,
          segments: updatedSegments,
          quickTrans: updatedSegments.map(s => s.quick).join('\n')
        };
      }

      updateSession({ customTerms: merged, result: updatedResult }, false);
      db.bulkSaveCustomTerms(merged).catch(err => {
        console.error("App: db.bulkSaveCustomTerms failed", err);
      });
      if (currentId && auth.currentUser) {
        syncFirestoreData('vocab', currentId, 'POST', Array.from(novelTermsMap.values())).catch(err => {
          console.error("App: syncFirestoreData vocab failed", err);
        });
      }
    } catch (err) {
      console.error("App: handleUpdateTerms caught error:", err);
    }
  };

  // Quản lý cập nhật nhân vật an toàn - đảm bảo 100% ghi đè chuẩn xác lên Vietphrase và tách biệt chuẩn theo từng bộ truyện
  const handleUpdateCharacters = (novelChars: Character[]) => {
    try {
      const currentId = session.currentNovelId || '';
      // Giữ lại nhân vật thuộc các bộ truyện khác
      const otherChars = (session.characters || []).filter(c => c.novelId && c.novelId !== currentId);

      // Cho truyện hiện tại: dùng danh sách novelChars truyền vào (gán chuẩn novelId)
      const currentNovelChars = novelChars.map(c => ({
        ...c,
        chineseName: (c.chineseName || '').trim(),
        vietName: (c.vietName || '').trim(),
        novelId: currentId
      }));

      const merged = [...otherChars, ...currentNovelChars];

      // Tạo CustomMap chuẩn xác cho Vietphrase của truyện hiện tại
      const thisNovelTerms = (session.customTerms || []).filter(t => !currentId || t.novelId === currentId);
      const customMap = new Map<string, string>();
      currentNovelChars.forEach(c => {
        if (c.chineseName && c.vietName) customMap.set(c.chineseName, c.vietName);
      });
      thisNovelTerms.forEach(t => {
        if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
      });

      // Cập nhật ngay vào engine
      vietphraseEngine.setCustomMap(customMap);
      vietphraseEngine.notify();

      let updatedResult = session.result;
      if (session.result?.segments && session.result.segments.length > 0) {
        const updatedSegments = session.result.segments.map(seg => ({
          ...seg,
          quick: seg.source ? (vietphraseEngine.translate(seg.source, customMap) || seg.quick || '') : (seg.quick || '')
        }));
        updatedResult = {
          ...session.result,
          segments: updatedSegments,
          quickTrans: updatedSegments.map(s => s.quick).join('\n')
        };
      }

      updateSession({ characters: merged, result: updatedResult }, false);
      if (currentId && auth.currentUser) {
        syncFirestoreData('char', currentId, 'POST', currentNovelChars).catch(err => {
          console.error("App: syncFirestoreData char failed", err);
        });
      }
    } catch (err) {
      console.error("App: handleUpdateCharacters caught error:", err);
    }
  };

  // Quản lý cập nhật mối quan hệ / xưng hô theo từng bộ truyện
  const handleUpdateRelationships = (novelRels: Relationship[]) => {
    try {
      const currentId = session.currentNovelId || '';
      const otherRels = (session.relationships || []).filter(r => r.novelId && r.novelId !== currentId);
      const scopedNovelRels = novelRels.map(r => ({ ...r, novelId: currentId }));
      const merged = [...otherRels, ...scopedNovelRels];
      updateSession({ relationships: merged }, false);
      if (currentId && auth.currentUser) {
        syncFirestoreData('rel', currentId, 'POST', scopedNovelRels).catch(err => {
          console.error("App: syncFirestoreData rel failed", err);
        });
      }
    } catch (err) {
      console.error("App: handleUpdateRelationships caught error:", err);
    }
  };

  // Quản lý chuyển đổi truyện độc lập trên tab hiện tại (không làm ảnh hưởng tab/thiết bị khác)
  const handleSelectNovel = (id: string, isAutoInit = false) => {
    if (id === session.currentNovelId) return;

    if (isAutoInit) {
      setSession(prev => prev.currentNovelId ? prev : { ...prev, currentNovelId: id });
      return;
    }

    // 1. Lưu nháp phiên làm việc của truyện cũ vào scoped storage
    const oldNovelId = session.currentNovelId || 'default';
    try {
      const oldDraft = {
        docKey: session.docKey,
        inputText: session.inputText,
        deeplText: session.deeplText,
        preEditedText: session.preEditedText,
        result: session.result,
        currentChapterId: session.currentChapterId,
        completedSegments: session.completedSegments
      };
      setScopedStorageItem(`novel_draft_${oldNovelId}`, JSON.stringify(oldDraft));
    } catch (_) {}

    // 2. Khôi phục nháp phiên làm việc của truyện mới nếu có (chỉ trên tab này)
    let nextDraft: any = null;
    try {
      const savedNewDraft = getScopedStorageItem(`novel_draft_${id}`);
      if (savedNewDraft) {
        nextDraft = JSON.parse(savedNewDraft);
      }
    } catch (_) {}

    localSegmentTsRef.current = {};
    localCompletedTsRef.current = {};
    localFieldTsRef.current = {};
    localResultResetAtRef.current = 0;

    if (nextDraft) {
      const nextDocKey = nextDraft.currentChapterId || nextDraft.docKey || `draft_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      setSession(prev => ({
        ...prev,
        docKey: nextDocKey,
        currentNovelId: id,
        inputText: nextDraft.inputText || '',
        deeplText: nextDraft.deeplText || '',
        preEditedText: nextDraft.preEditedText || '',
        result: sanitizeResult(nextDraft.result),
        status: nextDraft.result?.segments?.length ? AppStatus.SUCCESS : AppStatus.IDLE,
        currentChapterId: nextDraft.currentChapterId,
        completedSegments: nextDraft.completedSegments || []
      }));
    } else {
      const freshDocKey = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      setSession(prev => ({
        ...prev,
        docKey: freshDocKey,
        currentNovelId: id,
        inputText: '',
        deeplText: '',
        preEditedText: '',
        result: null,
        status: AppStatus.IDLE,
        currentChapterId: undefined,
        completedSegments: []
      }));
    }
  };

  const handleUpdateSegment = (index: number, newNatural: string) => {
    if (!session.result) return;

    const cleanNewNatural = newNatural.replace(/\n+$/, "");
    const currentSegments = session.result.segments;
    if (currentSegments[index] && currentSegments[index].natural === cleanNewNatural) {
      return; // No actual change, skip to avoid redundant undo states and clearing redo
    }

    // Save undo state
    const currentNaturals = currentSegments.map(s => s.natural);
    setUndoStack(prev => [...prev, currentNaturals].slice(-100));
    setRedoStack([]);

    const newSegments = [...currentSegments];
    newSegments[index] = { ...newSegments[index], natural: cleanNewNatural };
    const newResult = {
        ...session.result,
        segments: newSegments,
        naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };

    const now = Date.now();
    localSegmentTsRef.current[index] = now;
    setSession(prev => ({ ...prev, result: newResult }));

    const docKey = session.currentChapterId || session.docKey || '';
    if (docKey && auth.currentUser) {
      updateDocCollabSegment(docKey, {
        novelId: session.currentNovelId,
        deviceId,
        currentChapterId: session.currentChapterId,
        segmentIndex: index,
        edit: { natural: cleanNewNatural },
        now
      }).catch(console.warn);
    }
    scheduleChapterProgressSave();

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, completedSegments: session.completedSegments, timestamp: now } 
          : item
      ));
    }
  };

  const handleUpdateSegmentData = (index: number, updatedFields: Partial<TranslationSegment>) => {
    if (!session.result) return;
    const currentSegments = session.result.segments;
    if (!currentSegments[index]) return;

    if (updatedFields.natural !== undefined && updatedFields.natural !== currentSegments[index].natural) {
      const currentNaturals = currentSegments.map(s => s.natural);
      setUndoStack(prev => [...prev, currentNaturals].slice(-100));
      setRedoStack([]);
    }

    const newSegments = [...currentSegments];
    newSegments[index] = { ...newSegments[index], ...updatedFields };

    const newResult: TranslationResponse = {
      ...session.result,
      segments: newSegments,
      naturalTranslation: newSegments.map(s => s.natural || '').join('\n'),
      quickTrans: newSegments.map(s => s.quick || '').join('\n'),
      deeplTranslation: newSegments.map(s => s.deepl || '').join('\n')
    };

    const now = Date.now();
    localSegmentTsRef.current[index] = now;
    setSession(prev => ({ ...prev, result: newResult }));

    const docKey = session.currentChapterId || session.docKey || '';
    if (docKey && auth.currentUser) {
      updateDocCollabSegment(docKey, {
        novelId: session.currentNovelId,
        deviceId,
        currentChapterId: session.currentChapterId,
        segmentIndex: index,
        edit: updatedFields,
        now
      }).catch(console.warn);
    }
    scheduleChapterProgressSave();

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, completedSegments: session.completedSegments, timestamp: now } 
          : item
      ));
    }
  };

  const handleDeleteSegment = (index: number) => {
    if (!session.result) return;
    const currentSegments = session.result.segments;
    if (index < 0 || index >= currentSegments.length) return;

    // Lưu trạng thái hoàn tác
    const currentNaturals = currentSegments.map(s => s.natural);
    setUndoStack(prev => [...prev, currentNaturals].slice(-100));
    setRedoStack([]);

    const newSegments = currentSegments.filter((_, i) => i !== index);

    const currentCompleted = session.completedSegments || [];
    const newCompleted = currentCompleted
      .filter(i => i !== index)
      .map(i => (i > index ? i - 1 : i));

    const newResult: TranslationResponse = {
      ...session.result,
      segments: newSegments,
      naturalTranslation: newSegments.map(s => s.natural || '').join('\n'),
      quickTrans: newSegments.map(s => s.quick || '').join('\n'),
      deeplTranslation: newSegments.map(s => s.deepl || '').join('\n')
    };

    setSession(prev => ({ ...prev, result: newResult, completedSegments: newCompleted }));
    pushFullDocCollabToCloud({ result: newResult, completedSegments: newCompleted });
    flushChapterProgressNow(newResult, newCompleted).catch(console.warn);

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, completedSegments: newCompleted, timestamp: Date.now() } 
          : item
      ));
    }
  };

  const applyNaturalLinesToSegments = (currentSegments: TranslationSegment[], naturalLines: string[]): TranslationSegment[] => {
    const cleanedNewNaturals = naturalLines.map(n => (n || '').replace(/\n+$/, ""));
    const maxLen = Math.max(currentSegments.length, cleanedNewNaturals.length);
    const rebuilt: TranslationSegment[] = [];

    for (let i = 0; i < maxLen; i++) {
      const existing = currentSegments[i];
      const nextNatural = cleanedNewNaturals[i] ?? '';
      if (existing) {
        rebuilt.push({ ...existing, natural: nextNatural });
      } else if (nextNatural.trim().length > 0) {
        rebuilt.push({
          source: '',
          quick: '',
          deepl: '',
          natural: nextNatural
        });
      }
    }

    while (
      rebuilt.length > 0 &&
      !(rebuilt[rebuilt.length - 1].source || '').trim() &&
      !(rebuilt[rebuilt.length - 1].quick || '').trim() &&
      !(rebuilt[rebuilt.length - 1].deepl || '').trim() &&
      !(rebuilt[rebuilt.length - 1].natural || '').trim()
    ) {
      rebuilt.pop();
    }

    return rebuilt;
  };

  const handleUpdateAllSegments = (newNaturals: string[]) => {
    if (!session.result) return;

    const currentSegments = session.result.segments;
    const newSegments = applyNaturalLinesToSegments(currentSegments, newNaturals);
    const hasChanged =
      newSegments.length !== currentSegments.length ||
      newSegments.some((seg, idx) => seg.natural !== (currentSegments[idx]?.natural || ''));

    if (!hasChanged) return; // No actual change

    // Save undo state
    const currentNaturals = currentSegments.map(s => s.natural);
    setUndoStack(prev => [...prev, currentNaturals].slice(-100));
    setRedoStack([]);

    const newResult = {
        ...session.result,
        segments: newSegments,
        naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    setSession(prev => ({ ...prev, result: newResult }));
    pushFullDocCollabToCloud({ result: newResult });
    flushChapterProgressNow(newResult).catch(console.warn);

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, completedSegments: session.completedSegments, timestamp: Date.now() } 
          : item
      ));
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || !session.result) return;
    
    const previousNaturals = undoStack[undoStack.length - 1];
    const currentNaturals = session.result.segments.map(s => s.natural);
    
    setUndoStack(prev => prev.slice(0, prev.length - 1));
    setRedoStack(prev => [...prev, currentNaturals]);
    
    const newSegments = applyNaturalLinesToSegments(session.result.segments, previousNaturals);
    
    const newResult = {
      ...session.result,
      segments: newSegments,
      naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    setSession(prev => ({ ...prev, result: newResult }));
    pushFullDocCollabToCloud({ result: newResult });
    flushChapterProgressNow(newResult).catch(console.warn);

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, timestamp: Date.now() } 
          : item
      ));
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !session.result) return;
    
    const nextNaturals = redoStack[redoStack.length - 1];
    const currentNaturals = session.result.segments.map(s => s.natural);
    
    setRedoStack(prev => prev.slice(0, prev.length - 1));
    setUndoStack(prev => [...prev, currentNaturals]);
    
    const newSegments = applyNaturalLinesToSegments(session.result.segments, nextNaturals);
    
    const newResult = {
      ...session.result,
      segments: newSegments,
      naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    setSession(prev => ({ ...prev, result: newResult }));
    pushFullDocCollabToCloud({ result: newResult });
    flushChapterProgressNow(newResult).catch(console.warn);

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, timestamp: Date.now() } 
          : item
      ));
    }
  };

  const handleToggleComplete = (index: number) => {
    const currentCompleted = session.completedSegments || [];
    const isCompleted = currentCompleted.includes(index);
    const nextDone = !isCompleted;
    const newCompleted = isCompleted 
        ? currentCompleted.filter(i => i !== index)
        : [...currentCompleted, index];
    
    const now = Date.now();
    localCompletedTsRef.current[index] = now;
    setSession(prev => ({ ...prev, completedSegments: newCompleted }));

    const docKey = session.currentChapterId || session.docKey || '';
    if (docKey && auth.currentUser) {
      updateDocCollabCompleted(docKey, {
        novelId: session.currentNovelId,
        deviceId,
        currentChapterId: session.currentChapterId,
        segmentIndex: index,
        done: nextDone,
        now
      }).catch(console.warn);
    }
    scheduleChapterProgressSave();

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, completedSegments: newCompleted, timestamp: now } 
          : item
      ));
    }
  };

  // Tự động dọn dẹp các chương trong thùng rác đã quá hạn 30 ngày
  useEffect(() => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expiredChapters = chapters.filter(c => c.deletedAt && (now - c.deletedAt > THIRTY_DAYS_MS));
    if (expiredChapters.length > 0) {
      expiredChapters.forEach(c => {
        db.deleteChapter(c.id).catch(console.warn);
        deleteChapterFromCloud(c.id).catch(console.warn);
      });
      setChapters(prev => prev.filter(c => !expiredChapters.some(e => e.id === c.id)));
    }
  }, [chapters]);

  // Kiểm tra và tự động lưu kho khi người dùng quên lưu (trước khi phân tích mới hoặc xóa)
  // Chỉ tự động lưu nếu trong kho CHƯA CÓ, còn nếu đã có thì cập nhật đúng chương đó
  const autoSaveIfUnsaved = async (currentSession: TranslationSession) => {
    if (!currentSession.result?.segments || currentSession.result.segments.length === 0) return;
    const inputTrim = currentSession.inputText.trim();
    if (!inputTrim) return;

    // Kiểm tra xem trong kho đã có hay chưa (chỉ xét các chương chưa bị chuyển vào thùng rác)
    const existingChapter = chapters.find(c => 
      !c.deletedAt && (
        (currentSession.currentChapterId && c.id === currentSession.currentChapterId) || 
        (c.inputText && c.inputText.trim() === inputTrim)
      )
    );

    if (existingChapter) {
      // ĐÃ CÓ TRONG KHO: Cập nhật đúng chương đó, tuyệt đối KHÔNG tạo bản nháp hay bản sao trùng lặp!
      const updatedChapter: Chapter = {
        ...existingChapter,
        result: currentSession.result,
        completedSegments: currentSession.completedSegments || [],
        preEditedText: currentSession.preEditedText || '',
        deeplText: currentSession.deeplText || '',
        timestamp: Date.now()
      };
      setChapters(prev => prev.map(c => c.id === existingChapter.id ? updatedChapter : c));
      await db.saveChapter(updatedChapter);
      saveChapterToCloud(updatedChapter).catch(console.warn);
    } else {
      // CHƯA CÓ TRONG KHO: Người dùng quên lưu nên tự động lưu kho
      const firstLine = inputTrim.split('\n')[0].trim();
      const firstDeepl = (currentSession.deeplText || '').trim().split('\n')[0].trim();
      let chapName = firstDeepl || firstLine;
      if (chapName.length > 50) chapName = chapName.substring(0, 50) + '...';
      if (!chapName) chapName = `Chương lưu ngày ${new Date().toLocaleDateString('vi-VN')}`;

      const newChapId = `chap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const newChapter: Chapter = {
        id: newChapId,
        novelId: currentSession.currentNovelId,
        name: chapName,
        timestamp: Date.now(),
        inputText: currentSession.inputText,
        deeplText: currentSession.deeplText,
        preEditedText: currentSession.preEditedText,
        result: currentSession.result,
        completedSegments: currentSession.completedSegments || []
      };

      setChapters(prev => [newChapter, ...prev]);
      await db.saveChapter(newChapter);
      saveChapterToCloud(newChapter).catch(console.warn);
    }
  };

  const handleClearSession = () => {
    // Xóa sạch ô nhập và giao diện ngay lập tức trong 0ms, không chờ đợi mạng
    setSession(prev => ({
      ...prev,
      inputText: '',
      deeplText: '',
      preEditedText: '',
      result: null,
      status: AppStatus.IDLE,
      currentChapterId: undefined,
      currentHistoryId: undefined,
      completedSegments: []
    }));

    pushFullDocCollabToCloud({
      inputText: '',
      deeplText: '',
      preEditedText: '',
      result: null,
      status: AppStatus.IDLE,
      currentChapterId: undefined,
      currentHistoryId: undefined,
      completedSegments: []
    });
  };

  // Hàm loại bỏ dòng trống và chuẩn hóa văn bản
  const cleanEmptyLines = (text: string): string => {
    if (!text) return '';
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  };

  // Xử lý tự động xóa dòng trống khi dán vào các ô Raw, DeepL, Edit
  const handleCleanPaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    field: 'inputText' | 'deeplText' | 'preEditedText'
  ) => {
    const pasteText = e.clipboardData.getData('text');
    if (!pasteText) return;

    // Lọc sạch các dòng trống khi dán và chuyển ngoặc kép cong thông minh cho ô Edit sẵn
    let cleanedText = cleanEmptyLines(pasteText);
    if (field === 'preEditedText') {
      cleanedText = convertToSmartQuotes(cleanedText);
    }

    e.preventDefault();
    const target = e.currentTarget;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    const currentVal = target.value || '';
    const nextVal = currentVal.substring(0, start) + cleanedText + currentVal.substring(end);

    updateSession({ [field]: nextVal });

    setTimeout(() => {
      try {
        target.selectionStart = target.selectionEnd = start + cleanedText.length;
      } catch {
        // ignore
      }
    }, 0);
  };

  // Nút thủ công: Xóa tất cả dòng trống ở cả 3 ô (Raw, DeepL, Edit)
  const handleRemoveAllEmptyLines = () => {
    const updates: Partial<TranslationSession> = {};
    if (session.inputText) {
      const cleaned = cleanEmptyLines(session.inputText);
      if (cleaned !== session.inputText) updates.inputText = cleaned;
    }
    if (session.deeplText) {
      const cleaned = cleanEmptyLines(session.deeplText);
      if (cleaned !== session.deeplText) updates.deeplText = cleaned;
    }
    if (session.preEditedText) {
      const cleaned = cleanEmptyLines(session.preEditedText);
      if (cleaned !== session.preEditedText) updates.preEditedText = cleaned;
    }
    if (Object.keys(updates).length > 0) {
      updateSession(updates);
    }
  };

  // Xóa dòng trống cho từng ô riêng lẻ
  const handleRemoveFieldEmptyLines = (field: 'inputText' | 'deeplText' | 'preEditedText') => {
    const val = session[field];
    if (!val) return;
    const cleaned = cleanEmptyLines(val);
    if (cleaned !== val) {
      updateSession({ [field]: cleaned });
    }
  };

  const handleTranslate = async (forceFastAlign = false) => {
    if (!session.inputText.trim()) return;

    // Trước khi phân tích văn bản mới, nếu phiên hiện tại có kết quả chưa lưu thì tự động bảo vệ vào kho
    if (session.result?.segments && session.result.segments.length > 0) {
      if (mode === 'beta') {
        autoSaveIfUnsaved(session).catch(console.warn);
      } else {
        await autoSaveIfUnsaved(session);
      }
    }
    
    // --- BƯỚC 1: TÍNH TOÁN VIETPHRASE ---
    // Chuẩn hóa và làm sạch tất cả dòng trống trước khi dịch / phân tích
    const cleanInput = cleanEmptyLines(session.inputText);
    const cleanDeepl = cleanEmptyLines(session.deeplText || '');
    const cleanPreEdit = cleanEmptyLines(session.preEditedText || '');

    const inputLines = cleanInput.split('\n').filter(Boolean);
    
    // Optimize: Convert customTerms & characters to Map once for current novel only
    const currentId = session.currentNovelId;
    const currentCharacters = (session.characters || []).filter(c => !currentId || c.novelId === currentId);
    const currentTerms = (session.customTerms || []).filter(t => !currentId || t.novelId === currentId);
    const currentRelationships = (session.relationships || []).filter(r => !currentId || r.novelId === currentId);

    const customMap = new Map<string, string>();
    currentCharacters.forEach(c => {
        if (c.chineseName && c.vietName) customMap.set(c.chineseName.trim(), c.vietName.trim());
    });
    currentTerms.forEach(t => {
        if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
    });

    const vpSegments = inputLines.map(line => ({
        source: line,
        quick: vietphraseEngine.translate(line, customMap), // Dịch Vietphrase
    }));
    
    const existingSavedChap = session.currentChapterId
      ? chaptersRef.current.find(c => c.id === session.currentChapterId && !c.deletedAt)
      : null;
    const keepChapterId = Boolean(
      existingSavedChap && (!existingSavedChap.result?.segments || existingSavedChap.result.segments.length === 0)
    );
    const nextChapterId = keepChapterId ? session.currentChapterId : undefined;
    const targetDocKey = nextChapterId || session.docKey || '';

    const hasPreEdited = !!(cleanPreEdit && cleanPreEdit.trim());
    const hasDeepl = !!(cleanDeepl && cleanDeepl.trim());

    // CHẾ ĐỘ BETA: Không dùng AI, chia đoạn cục bộ và hiển thị bảng ngay lập tức (0ms, không LOADING)
    if (mode === 'beta') {
      const alignBetaLinesLocally = (rawLines: string[], pastedText: string): string[] => {
        if (!pastedText.trim()) return new Array(rawLines.length).fill('');
        const tLines = pastedText.split('\n').map(l => l.trim()).filter(Boolean);
        const result = new Array(rawLines.length).fill('');
        if (tLines.length === 0 || rawLines.length === 0) return result;

        rawLines.forEach((_, idx) => {
          if (idx < tLines.length) {
            if (idx === rawLines.length - 1 && tLines.length > rawLines.length) {
              result[idx] = tLines.slice(idx).join(' ');
            } else {
              result[idx] = tLines[idx];
            }
          }
        });
        return result;
      };

      const preEditedLines = hasPreEdited ? alignBetaLinesLocally(inputLines, cleanPreEdit) : new Array(inputLines.length).fill('');
      const deeplLines = hasDeepl ? alignBetaLinesLocally(inputLines, cleanDeepl) : new Array(inputLines.length).fill('');

      const mergedSegments = inputLines.map((line, i) => ({
        source: line,
        natural: preEditedLines[i] || "",
        quick: vpSegments[i]?.quick || "",
        deepl: hasDeepl ? (deeplLines[i] || "") : ""
      }));

      const mergedResult: TranslationResponse = {
        segments: mergedSegments,
        sinoVietnamese: '',
        vocabulary: [],
        naturalTranslation: mergedSegments.map(s => s.natural).join('\n'),
        quickTrans: mergedSegments.map(s => s.quick).join('\n'),
        deeplTranslation: mergedSegments.map(s => s.deepl).join('\n')
      };

      const sanitized = sanitizeResult(mergedResult);
      const historyId = Date.now().toString();
      const now = Date.now();

      setSession(prev => ({
        ...prev,
        inputText: cleanInput,
        deeplText: cleanDeepl,
        preEditedText: cleanPreEdit,
        result: sanitized,
        resultUpdatedAt: now,
        status: AppStatus.SUCCESS,
        error: null,
        currentHistoryId: historyId,
        currentChapterId: nextChapterId,
        completedSegments: []
      }));

      pushFullDocCollabToCloud({
        inputText: cleanInput,
        deeplText: cleanDeepl,
        preEditedText: cleanPreEdit,
        currentChapterId: nextChapterId,
        result: sanitized,
        status: AppStatus.SUCCESS,
        currentHistoryId: historyId,
        completedSegments: []
      }, targetDocKey || undefined);

      if (keepChapterId && sanitized) {
        flushChapterProgressNow(sanitized, [], {
          inputText: cleanInput,
          deeplText: cleanDeepl,
          preEditedText: cleanPreEdit
        }).catch(console.warn);
      }

      const newHistoryItem: HistoryItem = {
        id: historyId,
        timestamp: now,
        sourceText: cleanInput,
        result: sanitized as TranslationResponse,
        modelId: 'None (Local Beta)',
        completedSegments: []
      };
      setHistory(prev => [newHistoryItem, ...prev].slice(0, 50));
      return;
    }

    if (cleanInput !== session.inputText || cleanDeepl !== session.deeplText || cleanPreEdit !== (session.preEditedText || '')) {
      updateSession({
        inputText: cleanInput,
        deeplText: cleanDeepl,
        preEditedText: cleanPreEdit
      });
    }

    // CHẾ ĐỘ EDIT: Hiển thị LOADING trong khi gọi AI
    updateSession({
      status: AppStatus.LOADING,
      error: null,
      result: null,
      completedSegments: [],
      currentHistoryId: undefined,
      ...(keepChapterId ? {} : { currentChapterId: undefined })
    });

    try {
      // --- BƯỚC 2: CHẠY SONG SONG DỊCH AI & GIÓNG HÀNG DEEPL ---
      const [translatedData, deeplLines] = await Promise.all([
        translateText(
          cleanInput,
          currentTerms,
          currentCharacters,
          currentRelationships
        ),
        hasDeepl ? alignTextWithAI(inputLines, cleanDeepl, forceFastAlign) : Promise.resolve([] as string[])
      ]);
      const data = translatedData;

      const mergedSegments = data.segments.map((seg: any, i: number) => ({
        ...seg,
        quick: vpSegments[i]?.quick !== undefined ? vpSegments[i].quick : (seg.quick || ''), // Prefer local Vietphrase
        deepl: deeplLines[i] || "" // Set DeepL reference
      }));

      const mergedResult = {
         ...data,
         segments: mergedSegments,
         naturalTranslation: mergedSegments.map(s => s.natural).join('\n'),
         quickTrans: mergedSegments.map(s => s.quick).join('\n'),
         deeplTranslation: mergedSegments.map(s => s.deepl).join('\n')
      };

      const sanitized = sanitizeResult(mergedResult);
      
      const historyId = Date.now().toString();
      
      setSession(prev => ({
        ...prev,
        result: sanitized,
        status: AppStatus.SUCCESS,
        currentHistoryId: historyId,
        completedSegments: []
      }));

      pushFullDocCollabToCloud({
        inputText: cleanInput,
        deeplText: cleanDeepl,
        preEditedText: cleanPreEdit,
        currentChapterId: nextChapterId,
        result: sanitized,
        status: AppStatus.SUCCESS,
        currentHistoryId: historyId,
        completedSegments: []
      }, targetDocKey || undefined);

      if (keepChapterId && sanitized) {
        flushChapterProgressNow(sanitized, [], {
          inputText: cleanInput,
          deeplText: cleanDeepl,
          preEditedText: cleanPreEdit
        }).catch(console.warn);
      }
      
      const newHistoryItem: HistoryItem = {
        id: historyId,
        timestamp: Date.now(),
        sourceText: cleanInput,
        result: sanitized as TranslationResponse,
        modelId: data.modelUsed,
        completedSegments: []
      };
      setHistory(prev => [newHistoryItem, ...prev].slice(0, 50));
    } catch (err: any) {
      setSession(prev => ({
        ...prev,
        error: err.message || "Đã xảy ra lỗi không xác định.", 
        status: AppStatus.ERROR 
      }));
    }
  };

  const handleRestoreHistory = (item: HistoryItem) => {
    const sanitized = sanitizeResult(item.result);
    const freshDocKey = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    // QUAN TRỌNG: Bỏ currentChapterId khi khôi phục từ Lịch sử để không ghi đè lên chương đang mở
    setSession(prev => ({
      ...prev,
      docKey: freshDocKey,
      inputText: item.sourceText,
      deeplText: item.result?.deeplTranslation || "",
      preEditedText: item.result?.naturalTranslation || "",
      result: sanitized,
      status: AppStatus.SUCCESS,
      error: null,
      completedSegments: item.completedSegments || [],
      currentHistoryId: item.id,
      currentChapterId: undefined
    }));
    pushFullDocCollabToCloud({
      docKey: freshDocKey,
      inputText: item.sourceText,
      deeplText: item.result?.deeplTranslation || "",
      preEditedText: item.result?.naturalTranslation || "",
      result: sanitized,
      status: AppStatus.SUCCESS,
      completedSegments: item.completedSegments || [],
      currentHistoryId: item.id,
      currentChapterId: undefined
    }, freshDocKey);
    setShowHistory(false);
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const handleSaveChapter = async (name: string) => {
    if (!session.result) return;
    const cleanName = name.trim();
    if (!cleanName) return;

    // Kiểm tra xem có chương nào khác cùng tên trong cùng bộ truyện không (chỉ xét chương chưa bị xóa)
    const duplicate = currentNovelChapters.find(c => 
      c.name.trim().toLowerCase() === cleanName.toLowerCase() && 
      c.id !== session.currentChapterId
    );

    if (duplicate) {
      alert(`Không được đặt trùng tên! Chương "${cleanName}" đã tồn tại trong kho chương. Vui lòng đặt tên khác.`);
      return;
    }

    const existingChap = session.currentChapterId ? chapters.find(c => c.id === session.currentChapterId && !c.deletedAt) : null;
    // BẢO VỆ CHƯƠNG KHÔNG BỊ GHI ĐÈ: Chỉ dùng lại ID khi tên trùng với chương đang mở
    const isSameChapter = existingChap && existingChap.name.trim().toLowerCase() === cleanName.toLowerCase();
    const chapterId = isSameChapter 
      ? session.currentChapterId! 
      : `chap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const now = Date.now();
    const newChapter: Chapter = {
      id: chapterId,
      novelId: session.currentNovelId,
      name: cleanName,
      timestamp: now,
      resultUpdatedAt: now,
      inputText: session.inputText,
      deeplText: session.deeplText,
      preEditedText: session.preEditedText,
      result: session.result,
      completedSegments: session.completedSegments
    };

    await db.saveChapter(newChapter);
    await saveChapterToCloud(newChapter);
    setChapters(prev => [newChapter, ...prev.filter(c => c.id !== chapterId)]);
    setSession(prev => ({ ...prev, docKey: chapterId, currentChapterId: chapterId, resultUpdatedAt: now }));
    pushFullDocCollabToCloud({ docKey: chapterId, currentChapterId: chapterId, resultUpdatedAt: now }, chapterId);
  };

  const handleRestoreChapter = async (chapter: Chapter) => {
    // Hợp nhất các chỉnh sửa mức đoạn mới nhất từ phòng cộng tác của chương này trước khi mở
    let mergedChapter = chapter;
    if (auth.currentUser) {
      const collab = await getDocCollabSessionFromCloud(chapter.id).catch(() => null);
      if (collab) {
        mergedChapter = mergeCollabIntoChapterSnapshot(chapter, collab);
      }
    }

    const resetTs = mergedChapter.resultUpdatedAt || mergedChapter.timestamp || Date.now();
    localResultResetAtRef.current = resetTs;
    localSegmentTsRef.current = {};
    localCompletedTsRef.current = {};
    localFieldTsRef.current = { inputText: resetTs, deeplText: resetTs, preEditedText: resetTs };

    setSession(prev => ({
      ...prev,
      docKey: mergedChapter.id,
      inputText: mergedChapter.inputText,
      deeplText: mergedChapter.deeplText || "",
      preEditedText: mergedChapter.preEditedText || "",
      result: sanitizeResult(mergedChapter.result),
      resultUpdatedAt: resetTs,
      status: mergedChapter.result?.segments?.length ? AppStatus.SUCCESS : AppStatus.IDLE,
      error: null,
      completedSegments: mergedChapter.completedSegments || [],
      currentHistoryId: undefined,
      currentChapterId: mergedChapter.id,
      currentNovelId: mergedChapter.novelId || prev.currentNovelId
    }));
    setShowChapters(false);
    setActiveView('editor');
  };

  // Tạo chương mới (đặt tên & lưu vào kho ngay lúc tạo) và mở màn hình edit
  const handleCreateNewChapterFromHome = async (chapterName: string, novelId?: string) => {
    const cleanName = chapterName.trim();
    if (!cleanName) return;

    const targetNovelId = novelId;
    const chapterId = `chap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const emptyResult: TranslationResponse = {
      naturalTranslation: '',
      quickTrans: '',
      sinoVietnamese: '',
      deeplTranslation: '',
      segments: [],
      vocabulary: []
    };

    const newChapter: Chapter = {
      id: chapterId,
      novelId: targetNovelId,
      name: cleanName,
      timestamp: now,
      resultUpdatedAt: now,
      inputText: '',
      deeplText: '',
      preEditedText: '',
      result: emptyResult,
      completedSegments: []
    };

    await db.saveChapter(newChapter);
    await saveChapterToCloud(newChapter);
    setChapters(prev => [newChapter, ...prev.filter(c => c.id !== chapterId)]);

    localResultResetAtRef.current = now;
    localSegmentTsRef.current = {};
    localCompletedTsRef.current = {};
    localFieldTsRef.current = { inputText: now, deeplText: now, preEditedText: now };

    setSession(prev => ({
      ...prev,
      docKey: chapterId,
      currentNovelId: targetNovelId !== undefined ? targetNovelId : prev.currentNovelId,
      inputText: '',
      deeplText: '',
      preEditedText: '',
      result: emptyResult,
      resultUpdatedAt: now,
      status: AppStatus.IDLE,
      error: null,
      completedSegments: [],
      currentChapterId: chapterId,
      currentHistoryId: undefined
    }));

    pushFullDocCollabToCloud({
      docKey: chapterId,
      currentChapterId: chapterId,
      currentNovelId: targetNovelId,
      inputText: '',
      deeplText: '',
      preEditedText: '',
      result: emptyResult,
      status: AppStatus.IDLE,
      completedSegments: [],
      resultUpdatedAt: now
    }, chapterId);

    setActiveView('editor');
  };

  // Quay về Màn hình chính (tự động lưu các thay đổi đang dở)
  const handleBackToHome = async () => {
    if (fieldSyncTimerRef.current) {
      clearTimeout(fieldSyncTimerRef.current);
      fieldSyncTimerRef.current = null;
      const pending = { ...pendingFieldsRef.current };
      pendingFieldsRef.current = {};
      if (activeDocKey && auth.currentUser && Object.keys(pending).length > 0) {
        updateDocCollabFields(activeDocKey, {
          novelId: sessionRef.current.currentNovelId,
          deviceId,
          currentChapterId: sessionRef.current.currentChapterId,
          ...pending,
          now: Date.now()
        }).catch(console.warn);
      }
    }

    if (sessionRef.current.currentChapterId && sessionRef.current.result) {
      await flushChapterProgressNow();
    } else if (sessionRef.current.result?.segments?.length) {
      await autoSaveIfUnsaved(sessionRef.current);
    }

    setIsFocusMode(false);
    setActiveView('home');
  };

  const handleCreateNovelFromHome = async (name: string): Promise<Novel | null> => {
    const id = Date.now().toString();
    const created = await createNovel(id, name.trim());
    setNovels(prev => {
      if (prev.some(n => n.id === created.id)) return prev;
      const next = [...prev, created];
      try { setScopedStorageItem('app_novels_cache', JSON.stringify(next)); } catch {}
      return next;
    });
    return created;
  };

  const handleRenameNovelFromHome = async (id: string, newName: string) => {
    await renameNovel(id, newName);
    setNovels(prev => {
      const next = prev.map(n => n.id === id ? { ...n, name: newName.trim() } : n);
      try { setScopedStorageItem('app_novels_cache', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // 1. Chuyển chương vào Thùng rác (hạn 30 ngày)
  const handleMoveToTrash = async (id: string) => {
    const chapter = chapters.find(c => c.id === id);
    if (!chapter) return;
    const updated: Chapter = { ...chapter, deletedAt: Date.now() };
    await db.saveChapter(updated);
    await saveChapterToCloud(updated);
    setChapters(prev => prev.map(c => c.id === id ? updated : c));
    if (session.currentChapterId === id) {
      setSession(prev => ({ ...prev, currentChapterId: undefined }));
    }
  };

  // 2. Khôi phục chương từ Thùng rác về kho lưu trữ
  const handleRestoreFromTrash = async (id: string) => {
    const chapter = chapters.find(c => c.id === id);
    if (!chapter) return;
    const { deletedAt, ...rest } = chapter;
    const updated: Chapter = { ...rest, timestamp: Date.now() };
    await db.saveChapter(updated);
    await saveChapterToCloud(updated);
    setChapters(prev => prev.map(c => c.id === id ? updated : c));
  };

  // 3. Xóa vĩnh viễn 1 chương khỏi Thùng rác
  const handlePermanentDeleteChapter = async (id: string) => {
    await db.deleteChapter(id);
    await deleteChapterFromCloud(id);
    setChapters(prev => prev.filter(c => c.id !== id));
    if (session.currentChapterId === id) {
      setSession(prev => ({ ...prev, currentChapterId: undefined }));
    }
  };

  // 4. Dọn sạch toàn bộ Thùng rác
  const handleEmptyTrash = async (skipConfirm = false, novelIdFilter?: string) => {
    const sourceList = novelIdFilter
      ? chapters.filter(c => (novelIdFilter === '__uncategorized__' ? !c.novelId : c.novelId === novelIdFilter))
      : (skipConfirm ? chapters : novelArchiveChapters);
    const trashItems = sourceList.filter(c => !!c.deletedAt);
    if (trashItems.length === 0) return;
    if (!skipConfirm && !window.confirm(`Bạn có chắc chắn muốn dọn sạch vĩnh viễn ${trashItems.length} chương trong thùng rác? Thao tác này không thể hoàn tác.`)) return;
    for (const c of trashItems) {
      await db.deleteChapter(c.id).catch(console.warn);
      await deleteChapterFromCloud(c.id).catch(console.warn);
    }
    setChapters(prev => prev.filter(c => !trashItems.some(t => t.id === c.id)));
  };

  const handleRenameChapter = async (id: string, newName: string) => {
    const chapter = chapters.find(c => c.id === id);
    if (!chapter) return;
    const updated = { ...chapter, name: newName };
    await db.saveChapter(updated);
    await saveChapterToCloud(updated);
    setChapters(prev => prev.map(c => c.id === id ? updated : c));
  };

  // Chuyển toàn bộ chương đang hoạt động vào thùng rác (an toàn hơn là xóa hẳn)
  const handleClearAllChapters = async () => {
    const activeItems = novelArchiveChapters.filter(c => !c.deletedAt);
    if (activeItems.length === 0) return;
    if (!window.confirm(`Chuyển tất cả ${activeItems.length} chương vào thùng rác? Bạn có thể khôi phục bất cứ lúc nào trong 30 ngày.`)) return;
    const now = Date.now();
    const toTrash = activeItems.map(c => ({ ...c, deletedAt: now }));
    for (const c of toTrash) {
      await db.saveChapter(c);
      await saveChapterToCloud(c);
    }
    setChapters(prev => prev.map(c => {
      const found = toTrash.find(t => t.id === c.id);
      return found || c;
    }));
    if (session.currentChapterId) {
      setSession(prev => ({ ...prev, currentChapterId: undefined }));
    }
  };

  const handleExportExcel = async () => {
    let novelName = "Truyện";
    const currentId = session.currentNovelId;
    try {
      const allNovels = await getNovels();
      const found = allNovels.find(n => n.id === currentId);
      if (found) novelName = found.name;
    } catch (e) {
      console.warn("Could not fetch novel name for export", e);
    }

    // Chỉ xuất dữ liệu của bộ truyện hiện tại
    const filteredTerms = (session.customTerms || []).filter(t => !currentId || !t.novelId || t.novelId === currentId);
    const filteredChars = (session.characters || []).filter(c => !currentId || !c.novelId || c.novelId === currentId);
    const filteredRels = (session.relationships || []).filter(r => !currentId || !r.novelId || r.novelId === currentId);
    const filteredShortcuts = getStoredShortcuts(currentId);

    exportToExcel(filteredTerms, filteredChars, filteredRels, novelName, filteredShortcuts);
  };

  const activeChapterObj = useMemo(() => {
    if (!session.currentChapterId) return null;
    return chapters.find(c => c.id === session.currentChapterId) || null;
  }, [chapters, session.currentChapterId]);

  if (activeView === 'home') {
    return (
      <HomeScreen
        novels={novels}
        chapters={chapters}
        customTerms={session.customTerms || []}
        selectedNovelFilter={homeNovelFilter}
        onSelectNovelFilter={setHomeNovelFilter}
        onCreateNovel={handleCreateNovelFromHome}
        onRenameNovel={handleRenameNovelFromHome}
        onOpenChapter={handleRestoreChapter}
        onCreateNewChapter={handleCreateNewChapterFromHome}
        onRenameChapter={handleRenameChapter}
        onMoveToTrash={handleMoveToTrash}
        onRestoreFromTrash={handleRestoreFromTrash}
        onPermanentDeleteChapter={handlePermanentDeleteChapter}
        onEmptyTrash={() => handleEmptyTrash(true, homeNovelFilter)}
        isLoadingData={isLoadingHomeData}
        isSignedIn={isSignedIn}
      />
    );
  }

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#F5E6D3] text-[#3E2723] font-sans lg:overflow-hidden">
      
      {/* HEADER */}
      {!isFocusMode && (
      <header className="sticky top-0 bg-[#4E342E] text-[#F5E6D3] border-b border-[#3E2723] h-14 flex items-center justify-between px-2 sm:px-4 shrink-0 z-20 shadow-md overflow-x-auto no-scrollbar touch-pan-x w-full max-w-full select-none">
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 pr-2">
          {/* Nút Quay lại Màn hình chính (Google Docs Home) */}
          <button
            onClick={handleBackToHome}
            className="h-8 px-2 sm:px-2.5 rounded-lg bg-[#3E2723] hover:bg-[#5D4037] border border-[#5D4037] text-[#FFECB3] text-[11px] font-bold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            title="Quay lại màn hình chính (Danh sách truyện & chương)"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Trang chủ</span>
          </button>

          {/* Segmented Mode Control */}
          <div className="flex bg-[#3E2723] p-0.5 rounded-lg border border-[#5D4037] shrink-0">
            <button
              onClick={() => setMode('edit')}
              className={`w-7 h-7 sm:w-auto sm:px-3 sm:py-1 rounded-md text-[11px] font-bold transition-all flex items-center justify-center shrink-0 ${mode === 'edit' ? 'bg-[#FFECB3] text-[#3E2723] shadow-sm' : 'text-[#D7CCC8] hover:text-[#FFECB3]'}`}
            >
              <span className="sm:hidden">E</span>
              <span className="hidden sm:inline">Edit</span>
            </button>
            <button
              onClick={() => {
                setMode('beta');
                if (session.status === AppStatus.LOADING) {
                  setSession(prev => ({
                    ...prev,
                    status: prev.result?.segments?.length ? AppStatus.SUCCESS : AppStatus.IDLE
                  }));
                }
              }}
              className={`w-7 h-7 sm:w-auto sm:px-3 sm:py-1 rounded-md text-[11px] font-bold transition-all flex items-center justify-center shrink-0 ${mode === 'beta' ? 'bg-[#FFECB3] text-[#3E2723] shadow-sm' : 'text-[#D7CCC8] hover:text-[#FFECB3]'}`}
            >
              <span className="sm:hidden">B</span>
              <span className="hidden sm:inline">Beta</span>
            </button>
          </div>

          {activeChapterObj && (
            <span className="hidden xl:inline-block text-xs font-semibold text-[#FFECB3]/90 max-w-[180px] truncate" title={activeChapterObj.name}>
              {activeChapterObj.name}
            </span>
          )}
        </div>
        
        {/* RIGHT CONTROLS */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <NovelSelector 
              currentNovelId={session.currentNovelId || ''} 
              onSelectNovel={handleSelectNovel} 
            />

            {/* Font chữ toàn web */}
            <div className="flex items-center gap-1 bg-[#5D4037]/80 hover:bg-[#5D4037] rounded-full border border-[#FFECB3]/30 px-2 py-1 transition-colors h-8 shrink-0" title="Chỉnh font chữ toàn trang">
              <Type size={12} className="text-[#FFECB3] shrink-0" />
              <select 
                value={currentFont} 
                onChange={(e) => setCurrentFont(e.target.value)}
                className="bg-transparent text-[#FFECB3] font-medium text-[10px] sm:text-[11px] outline-none cursor-pointer max-w-[85px] sm:max-w-[125px]"
              >
                <option value="default" className="text-black bg-white">Mặc định</option>
                <option value="times" className="text-black bg-white">Times New Roman</option>
                <option value="alegreya" className="text-black bg-white">Alegreya</option>
                <option value="garamond" className="text-black bg-white">Garamond</option>
                <option value="mali" className="text-black bg-white">Mali</option>
                <option value="dosis" className="text-black bg-white">Dosis</option>
              </select>
            </div>
            
            {/* 1. Icon Từ điển di động - Chỉ hiện trên mobile/tablet (< lg) */}
            <button 
              onClick={() => setShowMobileDict(true)}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-full border border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#5D4037] transition-all bg-[#5D4037]/20 shrink-0"
              title="Từ điển riêng"
            >
              <div className="w-5 h-5 border border-[#FFECB3]/40 rounded flex items-center justify-center font-bold text-[10px] text-[#FFECB3]">
                A
              </div>
            </button>

            {/* 2. Icon Nhân vật di động - Chỉ hiện trên mobile/tablet (< lg) */}
            <button 
              onClick={() => setShowMobileWorld(true)}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-full border border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#5D4037] transition-all bg-[#5D4037]/20 shrink-0"
              title="Nhân vật & Thiết lập thế giới"
            >
              <Users size={14} className="text-[#FFECB3]" />
            </button>

            <button 
              onClick={() => setShowShortcuts(true)} 
              className={`flex items-center justify-center gap-1 text-[10px] font-medium h-8 px-2 sm:px-2.5 rounded-full border transition-colors shrink-0 ${
                shortcutsEnabled 
                  ? 'text-[#FFECB3] hover:text-white hover:bg-[#5D4037] bg-[#5D4037]/40 border-[#FFECB3]/20' 
                  : 'text-[#A1887F] hover:text-white hover:bg-[#5D4037] border-[#5D4037]'
              }`}
              title="Bảng gõ tắt (Auto-replace)"
            >
               <Keyboard size={12} />
               <span className="hidden sm:inline">Gõ tắt</span>
               {shortcuts.length > 0 && (
                 <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-bold ${shortcutsEnabled ? 'bg-[#FFECB3]/20 text-[#FFECB3]' : 'bg-gray-600/40 text-gray-300'}`}>
                   {shortcuts.filter(s => s.enabled).length}
                 </span>
               )}
            </button>
            <button onClick={() => setShowChapters(true)} className="flex items-center justify-center gap-1 text-[10px] font-medium text-[#FFECB3] hover:text-white hover:bg-[#5D4037] bg-[#5D4037]/30 h-8 px-2 sm:px-2.5 rounded-full border border-[#FFECB3]/20 transition-colors shrink-0">
               <FolderOpen size={12} />
               <span className="hidden sm:inline">Kho chương</span>
               <span className="font-mono text-[9px] font-bold">({activeNovelChaptersCount})</span>
            </button>
            <button onClick={() => setShowHistory(true)} className="flex items-center justify-center gap-1 text-[10px] font-medium text-[#D7CCC8] hover:text-white hover:bg-[#5D4037] h-8 px-2 sm:px-2.5 rounded-full border border-[#5D4037] transition-colors shrink-0">
               <History size={12} />
               <span className="hidden sm:inline">Lịch sử</span>
            </button>
            {auth.currentUser && (
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[#3E2723]/80 rounded-full border border-[#5D4037] text-[10px] text-[#A5D6A7] shrink-0" title="Đồng bộ thời gian thực hai chiều giữa Laptop và Điện thoại">
                <span className="w-1.5 h-1.5 rounded-full bg-[#66BB6A] animate-pulse"></span>
                <span className="font-semibold text-[#C8E6C9]">Realtime Sync</span>
              </div>
            )}
            <AuthPanel />
        </div>
      </header>
      )}

      {/* FLOATING REALTIME NOTIFICATION TOAST */}
      {realtimeNotify && (
        <div className="fixed top-16 right-4 z-50 bg-[#2E7D32] text-white px-3.5 py-2 rounded-lg shadow-xl border border-[#43A047] text-xs font-bold flex items-center gap-2 transition-all">
          <RefreshCw size={14} className="animate-spin text-[#C8E6C9]" />
          <span>{realtimeNotify}</span>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex lg:overflow-hidden">
        {/* LEFT SIDEBAR */}
        <div className={`hidden lg:block w-80 border-r border-[#D7CCC8] bg-[#EFE5D9] shrink-0 ${isFocusMode ? 'lg:hidden' : ''}`}>
            <DictionarySidebar 
                currentNovelId={session.currentNovelId || ''}
                terms={session.customTerms} onExportExcel={handleExportExcel} 
                onUpdateTerms={handleUpdateTerms} 
                sheetUrl={session.sheetUrl} 
                onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
                refreshTrigger={vpLoaded}
                
            />
        </div>

        {/* CENTER MAIN CONTENT */}
        <main className={`flex-1 flex flex-col ${isFocusMode ? 'h-screen p-0 m-0 overflow-hidden' : 'lg:h-full lg:overflow-hidden'} bg-[#F5E6D3] min-w-0 sm:min-w-[320px]`}>
          <div className={`flex-1 ${isFocusMode ? 'h-full overflow-hidden' : 'lg:overflow-y-auto lg:overflow-x-hidden scroll-smooth'}`}>
             <div className={`flex flex-col ${isFocusMode ? 'h-full p-0' : 'px-2 pb-2'}`}>
                
                {/* INPUT AREA */}
                {!isFocusMode && (
                  <div className="mt-2 bg-white rounded-xl shadow-sm border border-[#D7CCC8] overflow-hidden transition-all focus-within:ring-2 focus-within:ring-[#8D6E63]/20 focus-within:border-[#8D6E63]/50 mb-2 flex flex-col">
                      <div className="flex justify-between items-center bg-[#EFEBE9]/50 px-3 py-1.5 border-b border-[#EFEBE9]">
                          <div className="flex items-center gap-2">
                              {mode === 'beta' && (
                                <span className="bg-[#5D4037] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                                    Beta
                                </span>
                              )}
                              <div className="flex items-center gap-1 text-[10px] font-bold text-[#8D6E63]">
                                  <Layers size={10} />
                                  <span>{segmentCount} đoạn văn</span>
                              </div>
                          </div>
                          <div className="flex gap-2">
                              <button 
                                  onClick={handleRemoveAllEmptyLines} 
                                  disabled={!session.inputText && !session.deeplText && !session.preEditedText} 
                                  className="text-[10px] text-[#8D6E63] hover:text-[#3E2723] px-2 py-1 rounded hover:bg-[#D7CCC8] flex items-center gap-1 disabled:opacity-50"
                                  title="Xóa tất cả các dòng trống trong ô Raw, DeepL và Edit"
                              >
                                  <AlignJustify size={10} /> Xóa dòng trống
                              </button>
                              <button 
                                  onClick={() => updateSession({ 
                                      inputText: EXAMPLE_TEXT, 
                                      deeplText: "Đường dài mới biết ngựa hay, ở lâu mới biết lòng dạ con người.",
                                      preEditedText: mode === 'beta' ? "Đường dài mới biết sức ngựa, ngày lâu mới tỏ lòng người." : ""
                                  })} 
                                  className="text-[10px] text-[#8D6E63] hover:text-[#3E2723] px-2 py-1 rounded hover:bg-[#D7CCC8] flex items-center gap-1"
                              >
                                  <Quote size={10} /> Ví dụ
                              </button>
                              <button 
                                  onClick={handleClearSession} 
                                  disabled={!session.inputText && !session.deeplText && !session.preEditedText} 
                                  className="text-[10px] text-[#8D6E63] hover:text-[#3E2723] px-2 py-1 rounded hover:bg-[#D7CCC8] flex items-center gap-1 disabled:opacity-50"
                              >
                                  <Eraser size={10} /> Xóa
                              </button>
                          </div>
                      </div>

                      <div className={`grid ${mode === 'beta' ? 'grid-cols-3' : 'grid-cols-2'} flex-1 min-h-[140px] divide-x divide-[#EFEBE9]`}>
                          <div className="flex flex-col flex-1">
                              <div className="flex items-center justify-between px-3 pt-1.5 bg-[#FAFAFA]/40">
                                  <div className="text-[9px] font-bold text-[#8D6E63] uppercase tracking-wider">1. Raw</div>
                                  {session.inputText && (
                                      <button
                                          type="button"
                                          onClick={() => handleRemoveFieldEmptyLines('inputText')}
                                          className="text-[9px] text-[#8D6E63] hover:text-[#3E2723] hover:underline cursor-pointer"
                                          title="Xóa dòng trống trong ô này"
                                      >
                                          Lọc dòng trống
                                      </button>
                                  )}
                              </div>
                              <textarea
                                  ref={textareaRef}
                                  value={session.inputText}
                                  onChange={(e) => updateSession({ inputText: e.target.value })}
                                  onPaste={(e) => handleCleanPaste(e, 'inputText')}
                                  placeholder="Nhập Raw (Trung)..."
                                  className="flex-1 p-3 text-lg font-serif-sc bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed"
                                  spellCheck="false"
                              />
                          </div>
                          <div className="flex flex-col flex-1">
                              <div className="flex items-center justify-between px-3 pt-1.5 bg-[#FAFAFA]/40">
                                  <div className="text-[9px] font-bold text-[#8D6E63] uppercase tracking-wider">2. DeepL {mode === 'beta' && <span className="text-[8px] font-normal lowercase text-[#BCAAA4]">(không bắt buộc)</span>}</div>
                                  {session.deeplText && (
                                      <button
                                          type="button"
                                          onClick={() => handleRemoveFieldEmptyLines('deeplText')}
                                          className="text-[9px] text-[#8D6E63] hover:text-[#3E2723] hover:underline cursor-pointer"
                                          title="Xóa dòng trống trong ô này"
                                      >
                                          Lọc dòng trống
                                      </button>
                                  )}
                              </div>
                              <textarea
                                  value={session.deeplText}
                                  onChange={(e) => updateSession({ deeplText: e.target.value })}
                                  onPaste={(e) => handleCleanPaste(e, 'deeplText')}
                                  onKeyDown={(e) => {
                                      const triggerKeys = [' ', 'Enter', 'Tab', ',', '.', '?', '!', ';', ':'];
                                      if (triggerKeys.includes(e.key)) {
                                          const triggerChar = e.key === 'Tab' ? '\t' : (e.key === 'Enter' ? '\n' : e.key);
                                          const { replaced, newText } = checkAndApplyShortcut(e.currentTarget, shortcuts, triggerChar);
                                          if (replaced) {
                                              e.preventDefault();
                                              updateSession({ deeplText: newText });
                                          }
                                      }
                                  }}
                                  placeholder="Dán DeepL vào đây..."
                                  className="flex-1 p-3 text-sm bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed"
                                  spellCheck="false"
                              />
                          </div>
                          {mode === 'beta' && (
                              <div className="flex flex-col flex-1">
                                  <div className="flex items-center justify-between px-3 pt-1.5 bg-[#FAFAFA]/40">
                                      <div className="text-[9px] font-bold text-[#E64A19] uppercase tracking-wider flex items-center gap-1">3. Edit sẵn <span className="bg-[#E64A19] text-white text-[7px] px-1 rounded-full uppercase">Beta</span></div>
                                      {session.preEditedText && (
                                          <button
                                              type="button"
                                              onClick={() => handleRemoveFieldEmptyLines('preEditedText')}
                                              className="text-[9px] text-[#E64A19] hover:text-[#BF360C] hover:underline cursor-pointer"
                                              title="Xóa dòng trống trong ô này"
                                          >
                                              Lọc dòng trống
                                          </button>
                                      )}
                                  </div>
                                  <textarea
                                      value={session.preEditedText || ''}
                                      onChange={(e) => updateSession({ preEditedText: e.target.value })}
                                      onPaste={(e) => handleCleanPaste(e, 'preEditedText')}
                                      onKeyDown={(e) => {
                                          const triggerKeys = [' ', 'Enter', 'Tab', ',', '.', '?', '!', ';', ':'];
                                          if (triggerKeys.includes(e.key)) {
                                              const triggerChar = e.key === 'Tab' ? '\t' : (e.key === 'Enter' ? '\n' : e.key);
                                              const { replaced, newText } = checkAndApplyShortcut(e.currentTarget, shortcuts, triggerChar);
                                              if (replaced) {
                                                  e.preventDefault();
                                                  updateSession({ preEditedText: newText });
                                              }
                                          }
                                      }}
                                      placeholder="Dán Edit sẵn vào đây..."
                                      className="flex-1 p-3 text-sm bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed font-medium text-[#4E342E]"
                                      spellCheck="false"
                                  />
                              </div>
                          )}
                      </div>

                      {matchedDraft && (
                          <div className="mx-2 my-1.5 p-2.5 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between text-xs text-amber-950 shadow-2xs animate-in fade-in">
                              <div className="flex items-center gap-2 min-w-0">
                                  <BookOpen size={16} className="text-amber-700 shrink-0" />
                                  <span className="truncate">Phát hiện bản dịch/nháp của chương này trong {matchedDraft.type === 'chapter' ? 'Kho chương' : 'Lịch sử'}: <strong>{matchedDraft.name}</strong></span>
                              </div>
                              <button
                                  type="button"
                                  onClick={() => {
                                      if (matchedDraft.type === 'chapter') {
                                          handleRestoreChapter(matchedDraft.data as Chapter);
                                      } else {
                                          handleRestoreHistory(matchedDraft.data as HistoryItem);
                                      }
                                  }}
                                  className="ml-2 px-3 py-1 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded text-xs shadow-2xs transition-colors shrink-0 cursor-pointer flex items-center gap-1.5"
                              >
                                  <RotateCcw size={13} /> Khôi phục ngay
                              </button>
                          </div>
                      )}

                      <div className="flex justify-between items-center p-2 border-t border-[#EFEBE9] bg-[#FAFAFA]">
                          <div className="flex items-center gap-4">
                              <div className="text-[10px] font-medium transition-colors text-[#A1887F]">
                                  {session.inputText.length} ký tự
                              </div>
                          </div>
                          <button
                              onClick={() => handleTranslate(false)}
                              disabled={session.status === AppStatus.LOADING || !session.inputText.trim()}
                              className="bg-[#3E2723] text-[#FFECB3] hover:bg-[#4E342E] disabled:bg-[#A1887F] disabled:cursor-not-allowed px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
                          >
                              {session.status === AppStatus.LOADING ? (<><Loader2 className="animate-spin" size={14} /> Phân tích...</>) : 'Phân tích'}
                          </button>
                      </div>
                  </div>
                )}

                {/* ERROR */}
                {session.status === AppStatus.ERROR && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm flex gap-3 items-start shrink-0 mb-6">
                        <AlertTriangle className="shrink-0 text-red-600" size={16} /> 
                        <div className="flex-1"><p className="font-bold mb-1">Đã xảy ra lỗi:</p><p className="opacity-90 leading-relaxed whitespace-pre-wrap">{session.error}</p></div>
                    </div>
                )}

                {/* RESULT */}
                {(session.result && (session.status === AppStatus.SUCCESS || session.status === AppStatus.LOADING)) ? (
                    <div className={isFocusMode ? "h-full w-full" : "sticky top-2 z-10"}>
                        <div className={isFocusMode ? "h-full w-full" : "h-[calc(100vh-4.5rem)]"}>
                            <TranslationOutput 
                                data={session.result} 
                                chapterTitle={activeChapterObj?.name}
                                customTerms={session.customTerms} 
                                characters={session.characters} 
                                completedSegments={session.completedSegments || []}
                                onUpdateSegment={handleUpdateSegment} 
                                onUpdateAllSegments={handleUpdateAllSegments}
                                onUpdateSegmentData={handleUpdateSegmentData}
                                onDeleteSegment={handleDeleteSegment}
                                onToggleComplete={handleToggleComplete}
                                onSaveChapter={handleSaveChapter}
                                existingChapterNames={currentNovelChapters.map(c => c.name)}
                                onUndo={handleUndo}
                                onRedo={handleRedo}
                                canUndo={undoStack.length > 0}
                                canRedo={redoStack.length > 0}
                                isFocusMode={isFocusMode}
                                onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                                onUpdateTerms={handleUpdateTerms}
                                onUpdateCharacters={handleUpdateCharacters}
                                currentNovelId={session.currentNovelId || ''}
                                onOpenDictionary={() => setShowMobileDict(true)}
                                onOpenWorldInfo={() => setShowMobileWorld(true)}
                            />
                        </div>
                    </div>
                ) : (
                    session.status === AppStatus.IDLE && (
                        <div className="flex flex-col items-center justify-center text-[#BCAAA4] border-2 border-dashed border-[#D7CCC8] rounded-xl py-12">
                            <Layout size={32} className="mb-2 opacity-50"/>
                            <p className="text-xs">Khu vực hiển thị kết quả</p>
                        </div>
                    )
                )}
             </div>
          </div>
        </main>

        {/* RIGHT SIDEBAR */}
        <div className={`hidden lg:block w-[360px] border-l border-[#D7CCC8] bg-[#EFE5D9] shrink-0 ${isFocusMode ? 'lg:hidden' : ''}`}>
            <WorldInfoPanel 
                currentNovelId={session.currentNovelId || ''}
                characters={session.characters} 
                onUpdateCharacters={handleUpdateCharacters} 
                relationships={session.relationships} 
                onUpdateRelationships={handleUpdateRelationships} 
                notes={session.notes} 
                onUpdateNotes={(val) => updateSession({ notes: val })} 
                sheetUrl={session.sheetUrl} 
                onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
                
            />
        </div>
      </div>

      {/* MOBILE & FOCUS MODE LEFT SIDEBAR DICTIONARY (OVERLAY) */}
      {showMobileDict && (
        <div className={`fixed inset-0 z-50 flex ${isFocusMode ? '' : 'lg:hidden'} bg-black/40 backdrop-blur-xs transition-opacity`}>
          <div className="relative w-80 max-w-[85vw] h-full bg-[#EFE5D9] shadow-2xl flex flex-col animate-slide-in-left">
            <button 
              onClick={() => setShowMobileDict(false)}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-[#3E2723] shadow-sm z-50 border border-[#D7CCC8]"
            >
              <X size={16} />
            </button>
            <div className="flex-1 overflow-hidden pt-10">
              <DictionarySidebar 
                  currentNovelId={session.currentNovelId || ''}
                  terms={session.customTerms} onExportExcel={handleExportExcel} 
                  onUpdateTerms={handleUpdateTerms}
                  sheetUrl={session.sheetUrl} 
                  onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
                  refreshTrigger={vpLoaded}
              />
            </div>
          </div>
          {/* Click outside to close */}
          <div className="flex-1" onClick={() => setShowMobileDict(false)} />
        </div>
      )}

      {/* MOBILE & FOCUS MODE RIGHT SIDEBAR WORLD INFO (OVERLAY) */}
      {showMobileWorld && (
        <div className={`fixed inset-0 z-50 flex ${isFocusMode ? '' : 'lg:hidden'} bg-black/40 backdrop-blur-xs transition-opacity justify-end`}>
          {/* Click outside to close */}
          <div className="flex-1" onClick={() => setShowMobileWorld(false)} />
          <div className="relative w-[360px] max-w-[85vw] h-full bg-[#EFE5D9] shadow-2xl flex flex-col animate-slide-in-right">
            <button 
              onClick={() => setShowMobileWorld(false)}
              className="absolute top-2 left-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-[#3E2723] shadow-sm z-50 border border-[#D7CCC8]"
            >
              <X size={16} />
            </button>
            <div className="flex-1 overflow-hidden pt-10">
              <WorldInfoPanel 
                  currentNovelId={session.currentNovelId || ''}
                  characters={session.characters} 
                  onUpdateCharacters={handleUpdateCharacters} 
                  relationships={session.relationships} 
                  onUpdateRelationships={handleUpdateRelationships} 
                  notes={session.notes} 
                  onUpdateNotes={(val) => updateSession({ notes: val })} 
                  sheetUrl={session.sheetUrl} 
                  onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
              />
            </div>
          </div>
        </div>
      )}

      <HistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} history={history} onSelect={handleRestoreHistory} onDelete={deleteHistoryItem} onClearAll={() => setHistory([])} />

      <ChapterArchiveModal 
        isOpen={showChapters} 
        onClose={() => setShowChapters(false)} 
        chapters={novelArchiveChapters} 
        customTerms={(session.customTerms || []).filter(t => !session.currentNovelId || t.novelId === session.currentNovelId)} 
        onSelectChapter={handleRestoreChapter} 
        onMoveToTrash={handleMoveToTrash}
        onRestoreFromTrash={handleRestoreFromTrash}
        onPermanentDeleteChapter={handlePermanentDeleteChapter}
        onRenameChapter={handleRenameChapter} 
        onClearAll={handleClearAllChapters} 
        onEmptyTrash={() => handleEmptyTrash(false)}
      />

      <ShortcutModal 
        isOpen={showShortcuts} 
        onClose={() => setShowShortcuts(false)} 
        currentNovelId={session.currentNovelId || ''}
        onSelectNovel={handleSelectNovel}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}