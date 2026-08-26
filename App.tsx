
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AppStatus, TranslationSession, HistoryItem, TranslationResponse, Chapter } from './types';
import { translateText } from './services/geminiService';
import { alignTextWithAI } from './services/geminiService';
import { exportToExcel } from './services/excelService';
import { getNovels, getChaptersFromCloud, saveChapterToCloud, bulkSaveChaptersToCloud, deleteChapterFromCloud, clearNovelChaptersFromCloud, syncFirestoreData } from './services/firestoreService';
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
import { BookOpen, Loader2, Eraser, Quote, Layout, History, AlertTriangle, Layers, PenLine, FolderOpen, Keyboard, Users } from 'lucide-react';
import { checkAndApplyShortcut, getStoredShortcuts, isShortcutsEnabled, syncShortcutsFromCloud } from './services/shortcutService';

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
                natural: (s.natural || "").trim().replace(/\n+$/, ""),
                quick: (s.quick || "").trim().replace(/\n+$/, ""),
                deepl: (s.deepl || "").trim().replace(/\n+$/, "")
            })),
            naturalTranslation: (result.naturalTranslation || "").trim().replace(/\n+$/, ""),
            quickTrans: (result.quickTrans || "").trim().replace(/\n+$/, ""),
            deeplTranslation: (result.deeplTranslation || "").trim().replace(/\n+$/, ""),
            vocabulary: result.vocabulary || []
        };
    } catch (e) {
        console.warn("Sanitize failed, keeping original", e);
        return result;
    }
};

const createNewSession = (): TranslationSession => ({
  id: 'session_main',
  name: `Bản edit`,
  inputText: '',
  deeplText: '',
  preEditedText: '',
  status: AppStatus.IDLE,
  result: null,
  error: null,
  modelId: 'auto',
  currentHistoryId: undefined,
  customTerms: [],
  sheetUrl: '',
  characters: [],    
  relationships: [], 
  notes: '',
  completedSegments: []
});

function AppContent() {
  // --- STATE ---
  const [mode, setMode] = useState<'edit' | 'beta'>(() => {
    try {
      const savedMode = localStorage.getItem('app_mode');
      return (savedMode === 'beta' || savedMode === 'edit') ? savedMode : 'edit';
    } catch (e) {
      return 'edit';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('app_mode', mode);
    } catch (e) {}
  }, [mode]);

  const [session, setSession] = useState<TranslationSession>(() => {
    try {
      const savedSingle = localStorage.getItem('chiVietSingleSession');
      if (savedSingle) {
          const parsed = JSON.parse(savedSingle);
          // Force customTerms empty to load from DB instead (avoid localStorage quota)
          return { ...createNewSession(), ...parsed, customTerms: [], result: sanitizeResult(parsed.result) };
      }
      return createNewSession();
    } catch (e) {
      console.error("Failed to load session", e);
      return createNewSession();
    }
  });

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('chiVietHistory');
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
  const [shortcuts, setShortcuts] = useState(() => getStoredShortcuts(session.currentNovelId));
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => isShortcutsEnabled());
  const [vpLoaded, setVpLoaded] = useState(false);
  const [showDictSidebar, setShowDictSidebar] = useState(false);
  const [showWorldSidebar, setShowWorldSidebar] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setShowDictSidebar(true);
      setShowWorldSidebar(true);
    }
  }, []);

  useEffect(() => {
    setShortcuts(getStoredShortcuts(session.currentNovelId));
    if (session.currentNovelId) {
      syncShortcutsFromCloud(session.currentNovelId).then(cloudList => {
        if (cloudList) setShortcuts(cloudList);
      }).catch(console.warn);
    }
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

  // --- REFS ---
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- COMPUTED ---
  const segmentCount = session.inputText.trim() ? session.inputText.split(/\n/).length : 0;

  const currentNovelChapters = useMemo(() => {
    return chapters.filter(c => c.novelId === session.currentNovelId);
  }, [chapters, session.currentNovelId]);

  // --- EFFECTS ---
  // Init Vietphrase Engine from DB & Load Custom Terms
useEffect(() => {
  (async () => {
    await vietphraseEngine.init();
    console.log("Vietphrase Engine Initialized");
    setVpLoaded(true);
  })();
     
     db.getAllCustomTerms().then(terms => {
         if (terms && terms.length > 0) {
             setSession(prev => ({ ...prev, customTerms: terms }));
         }
     });

     db.getAllChapters().then(savedChapters => {
         if (savedChapters) {
             setChapters(savedChapters);
         }
     });
}, []);

  // Tự động tải và đồng bộ Kho chương từ Cloud Firestore
  useEffect(() => {
    let isMounted = true;
    const fetchCloudChapters = async () => {
      const user = auth.currentUser;
      if (!user || !session.currentNovelId) return;
      try {
        const cloudChapters = await getChaptersFromCloud(session.currentNovelId);
        if (!isMounted) return;

        // Lấy tất cả chương hiện tại thuộc truyện
        const allCurrentChapters = await db.getAllChapters();
        const localChaptersForNovel = (allCurrentChapters || []).filter(c => !c.novelId || c.novelId === session.currentNovelId);
        
        // Nếu có chương cục bộ chưa có trên đám mây, đẩy toàn bộ lên đám mây
        const cloudIds = new Set((cloudChapters || []).map(c => c.id));
        const unsynced = localChaptersForNovel.filter(c => !cloudIds.has(c.id));
        if (unsynced.length > 0) {
          const toUpload = unsynced.map(c => ({ ...c, novelId: session.currentNovelId! }));
          await bulkSaveChaptersToCloud(toUpload);
          // Cập nhật lại db cục bộ
          toUpload.forEach(c => db.saveChapter(c));
        }

        // Hợp nhất dữ liệu
        const mergedMap = new Map<string, Chapter>();
        localChaptersForNovel.forEach(c => mergedMap.set(c.id, { ...c, novelId: session.currentNovelId! }));
        (cloudChapters || []).forEach(c => mergedMap.set(c.id, c));
        const mergedList = Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        setChapters(prev => {
          const otherNovelsChapters = prev.filter(c => c.novelId && c.novelId !== session.currentNovelId);
          return [...mergedList, ...otherNovelsChapters];
        });
      } catch (err) {
        console.error("Lỗi tải/đồng bộ chương từ đám mây:", err);
      }
    };

    fetchCloudChapters();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) fetchCloudChapters();
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [session.currentNovelId]);

  // Tự động tải và đồng bộ Từ vựng của truyện hiện tại từ Cloud Firestore
  useEffect(() => {
    let isMounted = true;
    const fetchCloudVocab = async () => {
      const user = auth.currentUser;
      if (!user || !session.currentNovelId) return;
      try {
        const cloudTerms = await syncFirestoreData<any>('vocab', session.currentNovelId, 'GET');
        if (!isMounted || !cloudTerms || cloudTerms.length === 0) return;
        
        setSession(prev => {
          const currentId = session.currentNovelId;
          const otherTerms = (prev.customTerms || []).filter(t => t.novelId && t.novelId !== currentId);
          const localNovelTerms = (prev.customTerms || []).filter(t => !t.novelId || t.novelId === currentId);
          
          const termMap = new Map<string, any>();
          localNovelTerms.forEach(t => termMap.set(t.id, t));
          cloudTerms.forEach(t => termMap.set(t.id, t));
          
          const merged = [...Array.from(termMap.values()), ...otherTerms];
          db.bulkSaveCustomTerms(merged).catch(console.error);
          return { ...prev, customTerms: merged };
        });
      } catch (err) {
        console.warn("Auto sync vocab in App error:", err);
      }
    };

    fetchCloudVocab();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) fetchCloudVocab();
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [session.currentNovelId]);

  // Fix lỗi QuotaExceededError khi lưu Session
  useEffect(() => {
    try {
        // Exclude customTerms from localStorage to save space
        const sessionToSave = { ...session, customTerms: [] };
        localStorage.setItem('chiVietSingleSession', JSON.stringify(sessionToSave));
    } catch (e) {
        if (session.result) {
            try {
                // Thử lưu bản rút gọn (bỏ bớt segments nặng)
                const leanResult = { ...session.result, segments: [] };
                const leanSession = { ...session, customTerms: [], result: leanResult };
                localStorage.setItem('chiVietSingleSession', JSON.stringify(leanSession));
            } catch (innerE) {
                try {
                    // Thử lưu không có result để cứu inputText
                    const ultraLeanSession = { ...session, customTerms: [], result: null };
                    localStorage.setItem('chiVietSingleSession', JSON.stringify(ultraLeanSession));
                } catch (lastE) {
                    console.warn("Storage Quota Exceeded for Session");
                }
            }
        }
    }
  }, [session]);

  // Fix lỗi QuotaExceededError khi lưu History
  useEffect(() => {
    try {
        localStorage.setItem('chiVietHistory', JSON.stringify(history));
    } catch (e) {
        // Nếu bộ nhớ đầy, nén bớt history bằng cách lược bỏ segments của các bản ghi cũ
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
            localStorage.setItem('chiVietHistory', JSON.stringify(leanHistory));
        } catch (innerE) {
            try {
                // Nếu vẫn đầy, chỉ giữ 5 bản ghi và bỏ hết segments
                const superLeanHistory = history.slice(0, 5).map(item => ({
                    ...item,
                    result: item.result ? {
                        ...item.result,
                        segments: []
                    } : null
                }));
                localStorage.setItem('chiVietHistory', JSON.stringify(superLeanHistory));
            } catch (lastE) {
                console.warn("Storage Quota Exceeded for History");
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

  // --- ACTIONS ---

  const updateSession = (updates: Partial<TranslationSession>) => {
    setSession(prev => ({ ...prev, ...updates }));
  };

  const autoSaveLinkedChapter = (newResult: any, newCompleted?: number[]) => {
    if (!session.currentChapterId) return;
    
    setChapters(prev => prev.map(c => {
      if (c.id === session.currentChapterId) {
        const updated = {
          ...c,
          result: newResult || c.result,
          completedSegments: newCompleted !== undefined ? newCompleted : (c.completedSegments || []),
          timestamp: Date.now()
        };
        db.saveChapter(updated).catch(err => console.error("Auto-save chapter failed", err));
        saveChapterToCloud(updated).catch(err => console.error("Auto-save cloud chapter failed", err));
        return updated;
      }
      return c;
    }));
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
    
    updateSession({ result: newResult });
    autoSaveLinkedChapter(newResult);

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult, completedSegments: session.completedSegments, timestamp: Date.now() } 
          : item
      ));
    }
  };

  const handleUpdateAllSegments = (newNaturals: string[]) => {
    if (!session.result) return;

    const currentSegments = session.result.segments;
    let hasChanged = false;
    const cleanedNewNaturals = newNaturals.map(n => (n || '').replace(/\n+$/, ""));
    
    for (let i = 0; i < currentSegments.length; i++) {
      if (currentSegments[i].natural !== (cleanedNewNaturals[i] || '')) {
        hasChanged = true;
        break;
      }
    }
    
    if (!hasChanged) return; // No actual change

    // Save undo state
    const currentNaturals = currentSegments.map(s => s.natural);
    setUndoStack(prev => [...prev, currentNaturals].slice(-100));
    setRedoStack([]);

    const newSegments = currentSegments.map((seg, idx) => ({
      ...seg,
      natural: cleanedNewNaturals[idx] || ''
    }));

    const newResult = {
        ...session.result,
        segments: newSegments,
        naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    updateSession({ result: newResult });
    autoSaveLinkedChapter(newResult);

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
    
    const newSegments = session.result.segments.map((seg, idx) => ({
      ...seg,
      natural: previousNaturals[idx] || ""
    }));
    
    const newResult = {
      ...session.result,
      segments: newSegments,
      naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    updateSession({ result: newResult });
    autoSaveLinkedChapter(newResult);

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
    
    const newSegments = session.result.segments.map((seg, idx) => ({
      ...seg,
      natural: nextNaturals[idx] || ""
    }));
    
    const newResult = {
      ...session.result,
      segments: newSegments,
      naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    updateSession({ result: newResult });
    autoSaveLinkedChapter(newResult);

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
    const newCompleted = isCompleted 
        ? currentCompleted.filter(i => i !== index)
        : [...currentCompleted, index];
    
    updateSession({ completedSegments: newCompleted });
    autoSaveLinkedChapter(session.result, newCompleted);

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, completedSegments: newCompleted, timestamp: Date.now() } 
          : item
      ));
    }
  };

  const handleClearSession = async () => {
    if (!session.inputText.trim()) return;

    // --- TỰ ĐỘNG LƯU TRỮ CHƯƠNG ĐANG EDIT NẾU QUÊN CHƯA LƯU TRƯỚC KHI XÓA ---
    if (session.result && session.inputText.trim()) {
      const alreadySaved = chapters.some(c => c.inputText.trim() === session.inputText.trim());
      if (!alreadySaved) {
        let autoName = "";
        const lines = session.inputText.split('\n').map(l => l.trim()).filter(Boolean);
        
        for (const line of lines.slice(0, 5)) {
          if (line.match(/(Chương\s+\d+|第[一二三四五六七八九十百千万\d]+章)/i)) {
            const customMap = new Map<string, string>();
            (session.characters || []).forEach(c => {
                if (c.chineseName && c.vietName) customMap.set(c.chineseName.trim(), c.vietName.trim());
            });
            (session.customTerms || []).forEach(t => {
                if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
            });
            autoName = vietphraseEngine.translate(line, customMap);
            break;
          }
        }
        
        if (!autoName && session.result.segments && session.result.segments.length > 0) {
          const firstEditLine = session.result.segments[0].natural.trim();
          if (firstEditLine) {
            autoName = firstEditLine.slice(0, 50);
          }
        }
        
        if (!autoName) {
          autoName = `Chương tự động (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`;
        } else {
          autoName = `[Tự động - Xóa] ${autoName}`;
        }
        
        const autoChapter: Chapter = {
          id: `auto_${Date.now()}`,
          novelId: session.currentNovelId,
          name: autoName,
          timestamp: Date.now(),
          inputText: session.inputText,
          deeplText: session.deeplText,
          preEditedText: session.preEditedText,
          result: session.result,
          completedSegments: session.completedSegments
        };
        
        try {
          await db.saveChapter(autoChapter);
          await saveChapterToCloud(autoChapter);
          setChapters(prev => [autoChapter, ...prev]);
          console.log("Auto-saved draft on clear:", autoName);
        } catch (e) {
          console.error("Auto save on clear failed", e);
        }
      }
    }

    // Tiến hành xóa session
    updateSession({ inputText: '', deeplText: '', preEditedText: '', result: null, status: AppStatus.IDLE, currentChapterId: undefined, currentHistoryId: undefined });
  };

  const handleTranslate = async (forceFastAlign = false) => {
    if (!session.inputText.trim()) return;
    
    // --- BƯỚC TỰ ĐỘNG LƯU TRỮ CHƯƠNG ĐANG EDIT NẾU QUÊN CHƯA LƯU ---
    if (session.result && session.inputText.trim()) {
      const alreadySaved = chapters.some(c => c.inputText.trim() === session.inputText.trim());
      if (!alreadySaved) {
        let autoName = "";
        const lines = session.inputText.split('\n').map(l => l.trim()).filter(Boolean);
        
        for (const line of lines.slice(0, 5)) {
          if (line.match(/(Chương\s+\d+|第[一二三四五六七八九十百千万\d]+章)/i)) {
            const customMap = new Map<string, string>();
            (session.characters || []).forEach(c => {
                if (c.chineseName && c.vietName) customMap.set(c.chineseName.trim(), c.vietName.trim());
            });
            (session.customTerms || []).forEach(t => {
                if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
            });
            autoName = vietphraseEngine.translate(line, customMap);
            break;
          }
        }
        
        if (!autoName && session.result.segments && session.result.segments.length > 0) {
          const firstEditLine = session.result.segments[0].natural.trim();
          if (firstEditLine) {
            autoName = firstEditLine.slice(0, 50);
          }
        }
        
        if (!autoName) {
          autoName = `Chương tự động (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`;
        } else {
          autoName = `[Tự động] ${autoName}`;
        }
        
        const autoChapter: Chapter = {
          id: `auto_${Date.now()}`,
          novelId: session.currentNovelId,
          name: autoName,
          timestamp: Date.now(),
          inputText: session.inputText,
          deeplText: session.deeplText,
          preEditedText: session.preEditedText,
          result: session.result,
          completedSegments: session.completedSegments
        };
        
        try {
          await db.saveChapter(autoChapter);
          await saveChapterToCloud(autoChapter);
          setChapters(prev => [autoChapter, ...prev]);
          console.log("Auto-saved previous chapter draft before new translation:", autoName);
        } catch (e) {
          console.error("Auto save failed", e);
        }
      }
    }
    
    // --- BƯỚC 1: TÍNH TOÁN VIETPHRASE (LÀM TRƯỚC HOẶC SONG SONG VỚI GỌI API) ---
    // Mặc dù gọi là làm song song, nhưng do JS đơn luồng, ta sẽ tính toán Vietphrase
    // ngay lập tức (vì nó rất nhanh) để sẵn sàng merge khi AI trả về.
    const inputLines = session.inputText.split('\n');
    
    // Optimize: Convert customTerms & characters to Map once (customTerms take priority over characters)
    const customMap = new Map<string, string>();
    (session.characters || []).forEach(c => {
        if (c.chineseName && c.vietName) customMap.set(c.chineseName.trim(), c.vietName.trim());
    });
    (session.customTerms || []).forEach(t => {
        if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
    });

    const vpSegments = inputLines.map(line => ({
        source: line,
        quick: vietphraseEngine.translate(line, customMap), // Dịch Vietphrase
    }));
    
    // Tạo trạng thái giả lập (Draft) để người dùng thấy ngay kết quả sơ bộ nếu muốn
    // Tuy nhiên, ở đây ta sẽ giữ trạng thái LOADING cho đến khi có AI để trải nghiệm mượt mà hơn,
    // hoặc có thể hiển thị Quick Trans trước nếu muốn. 
    // Ở đây mình chọn LOADING và merge kết quả sau cùng để đồng bộ.
    updateSession({ status: AppStatus.LOADING, error: null, result: null, completedSegments: [], currentHistoryId: undefined, currentChapterId: undefined });

    try {
      const hasPreEdited = !!(session.preEditedText && session.preEditedText.trim());
      const hasDeepl = !!(session.deeplText && session.deeplText.trim());
      let data: any = null;

      if (mode === 'beta' && hasPreEdited) {
          data = {
              modelUsed: 'None (Local Alignment)',
              segments: []
          };
      } else {
          // --- BƯỚC 2: GỌI AI ---
          data = await translateText(
            session.inputText, 
            session.customTerms,
            session.characters,
            session.relationships
          );
      }
      
      // --- BƯỚC 3: MERGE KẾT QUẢ ---
      let mergedSegments = [];

      if (mode === 'beta' && hasPreEdited) {
         // Align pre-edited text to source lines
         const preEditedLines = await alignTextWithAI(inputLines, session.preEditedText || "");
         
         // Align GG/DeepL text to source lines if it was provided
         const deeplLines = hasDeepl ? await alignTextWithAI(inputLines, session.deeplText) : [];

         mergedSegments = inputLines.map((line, i) => {
             // In Beta mode:
             // - If GG/DeepL is NOT pasted, we just leave it empty since we skip AI
             // - If GG/DeepL IS pasted, we use the aligned GG/DeepL as "deepl" reference
             let refDeepl = "";
             if (hasDeepl) {
                 refDeepl = deeplLines[i] || "";
             }

             return {
                 source: line,
                 natural: preEditedLines[i] || "", // Main translation is replaced with aligned pre-edited text
                 quick: vpSegments[i]?.quick || "",
                 deepl: refDeepl
             };
         });
      } else {
         // Standard Edit Mode
         const deeplLines = await alignTextWithAI(inputLines, session.deeplText || "");
         mergedSegments = data.segments.map((seg, i) => ({
            ...seg,
            quick: vpSegments[i]?.quick || seg.quick, // Prefer local Vietphrase
            deepl: deeplLines[i] || "" // Set DeepL reference
         }));
      }

      const mergedResult = {
         ...data,
         segments: mergedSegments,
         naturalTranslation: mergedSegments.map(s => s.natural).join('\n'),
         quickTrans: mergedSegments.map(s => s.quick).join('\n'),
         deeplTranslation: mergedSegments.map(s => s.deepl).join('\n')
      };

      const sanitized = sanitizeResult(mergedResult);
      
      const historyId = Date.now().toString();
      
      updateSession({ 
        result: sanitized, 
        status: AppStatus.SUCCESS,
        currentHistoryId: historyId 
      });
      
      const newHistoryItem: HistoryItem = {
        id: historyId,
        timestamp: Date.now(),
        sourceText: session.inputText,
        result: sanitized as TranslationResponse,
        modelId: data.modelUsed,
        completedSegments: []
      };
      setHistory(prev => [newHistoryItem, ...prev].slice(0, 50));
    } catch (err: any) {
      updateSession({ 
        error: err.message || "Đã xảy ra lỗi không xác định.", 
        status: AppStatus.ERROR 
      });
    }
  };

  const handleRestoreHistory = (item: HistoryItem) => {
    updateSession({
      inputText: item.sourceText,
      deeplText: item.result?.deeplTranslation || "",
      preEditedText: item.result?.naturalTranslation || "",
      result: sanitizeResult(item.result),
      status: AppStatus.SUCCESS,
      error: null,
      completedSegments: item.completedSegments || [],
      currentHistoryId: item.id
    });
    setShowHistory(false);
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const handleSaveChapter = async (name: string) => {
    if (!session.result) return;

    // Reuse existing chapter ID if we are editing an active chapter, or overwrite by name
    const existingChapter = chapters.find(c => c.id === session.currentChapterId || c.name.trim().toLowerCase() === name.trim().toLowerCase());
    const chapterId = existingChapter?.id || `chap_${Date.now()}`;

    const newChapter: Chapter = {
      id: chapterId,
      novelId: session.currentNovelId,
      name,
      timestamp: Date.now(),
      inputText: session.inputText,
      deeplText: session.deeplText,
      preEditedText: session.preEditedText,
      result: session.result,
      completedSegments: session.completedSegments
    };

    await db.saveChapter(newChapter);
    await saveChapterToCloud(newChapter);
    setChapters(prev => [newChapter, ...prev.filter(c => c.id !== chapterId && c.name.trim().toLowerCase() !== name.trim().toLowerCase())]);
    updateSession({ currentChapterId: chapterId });
  };

  const handleRestoreChapter = (chapter: Chapter) => {
    updateSession({
      inputText: chapter.inputText,
      deeplText: chapter.deeplText || "",
      preEditedText: chapter.preEditedText || "",
      result: sanitizeResult(chapter.result),
      status: AppStatus.SUCCESS,
      error: null,
      completedSegments: chapter.completedSegments || [],
      currentHistoryId: undefined,
      currentChapterId: chapter.id,
      currentNovelId: chapter.novelId || session.currentNovelId
    });
    setShowChapters(false);
  };

  const handleDeleteChapter = async (id: string) => {
    await db.deleteChapter(id);
    await deleteChapterFromCloud(id);
    setChapters(prev => prev.filter(c => c.id !== id));
  };

  const handleRenameChapter = async (id: string, newName: string) => {
    const chapter = chapters.find(c => c.id === id);
    if (!chapter) return;
    const updated = { ...chapter, name: newName };
    await db.saveChapter(updated);
    await saveChapterToCloud(updated);
    setChapters(prev => prev.map(c => c.id === id ? updated : c));
  };

  const handleClearAllChapters = async () => {
    await db.clearAllChapters();
    if (session.currentNovelId) {
      await clearNovelChaptersFromCloud(session.currentNovelId);
    }
    setChapters([]);
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

  return (
    <div className="h-auto md:h-screen md:overflow-hidden overflow-y-auto flex flex-col bg-[#F5E6D3] text-[#3E2723] font-sans">
      
      {/* HEADER MATCHING IMAGE 100% */}
      <header className="bg-[#3E2723] text-[#F5E6D3] border-b border-[#2C1A12] h-14 flex items-center justify-between px-3 sm:px-4 shrink-0 z-20 shadow-md sticky top-0 w-full">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5">
            <PenLine className="text-amber-400" size={22} />
          </div>

          {/* Segmented Mode Control [ E | B ] */}
          <div className="flex bg-[#2D1B13] p-0.5 rounded-full border border-[#5D4037]">
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all ${mode === 'edit' ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs' : 'text-[#D7CCC8] hover:text-[#FFFDF7]'}`}
            >
              E
            </button>
            <button
              onClick={() => setMode('beta')}
              className={`px-3 py-0.5 rounded-full text-xs font-bold transition-all ${mode === 'beta' ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs' : 'text-[#D7CCC8] hover:text-[#FFFDF7]'}`}
            >
              B
            </button>
          </div>
        </div>
        
        {/* RIGHT CIRCULAR CONTROLS MATCHING IMAGE */}
        <div className="flex items-center gap-1.5 sm:gap-2">
            <button 
              onClick={() => setShowDictSidebar(!showDictSidebar)}
              className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
                showDictSidebar 
                  ? 'bg-amber-400 text-[#3E2723] border-amber-400' 
                  : 'border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#4E342E]'
              }`}
              title="Kho từ vựng"
            >
               <BookOpen size={16} />
            </button>

            <button 
              onClick={() => setShowWorldSidebar(!showWorldSidebar)}
              className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
                showWorldSidebar 
                  ? 'bg-amber-400 text-[#3E2723] border-amber-400' 
                  : 'border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#4E342E]'
              }`}
              title="Kho nhân vật & Thế giới"
            >
               <Users size={16} />
            </button>

            <button 
              onClick={() => setShowShortcuts(true)} 
              className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
                shortcutsEnabled 
                  ? 'bg-amber-400 text-[#3E2723] border-amber-400' 
                  : 'border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#4E342E]'
              }`}
              title="Phím tắt gõ nhanh"
            >
               <Keyboard size={16} />
            </button>

            <button 
              onClick={() => setShowChapters(true)} 
              className="h-9 px-3 rounded-full border border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#4E342E] transition-colors flex items-center gap-1 text-xs font-bold"
              title="Kho chương"
            >
               <FolderOpen size={15} />
               <span>({currentNovelChapters.length})</span>
            </button>

            <button 
              onClick={() => setShowHistory(true)} 
              className="w-9 h-9 rounded-full border border-[#5D4037] text-[#D7CCC8] hover:text-white hover:bg-[#4E342E] transition-colors flex items-center justify-center"
              title="Lịch sử dịch"
            >
               <History size={16} />
            </button>

            <AuthPanel />
        </div>
      </header>

      {/* MOBILE DRAWER FOR DICTIONARY */}
      {showDictSidebar && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/50 flex justify-start animate-in fade-in duration-150">
          <div className="w-[340px] max-w-[85vw] h-full bg-[#EFE5D9] shadow-2xl flex flex-col animate-slide-in-left">
            <div className="p-3 bg-[#3E2723] text-[#FFFDF7] flex justify-between items-center">
              <span className="font-bold text-sm">Kho Từ Vựng</span>
              <button onClick={() => setShowDictSidebar(false)} className="text-[#D7CCC8] hover:text-white p-1">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <DictionarySidebar 
                currentNovelId={session.currentNovelId || ''}
                terms={session.customTerms} 
                onExportExcel={handleExportExcel} 
                onUpdateTerms={(novelTerms) => {
                    try {
                        const currentId = session.currentNovelId;
                        const otherTerms = (session.customTerms || []).filter(t => t.novelId && t.novelId !== currentId);
                        const merged = [...novelTerms, ...otherTerms];
                        updateSession({ customTerms: merged });
                        db.bulkSaveCustomTerms(merged).catch(err => {
                            console.error("App Sidebar: db.bulkSaveCustomTerms failed", err);
                        });
                    } catch (err) {
                        console.error("App Sidebar: onUpdateTerms caught error:", err);
                    }
                }} 
                sheetUrl={session.sheetUrl} 
                onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
                refreshTrigger={vpLoaded}
              />
            </div>
          </div>
        </div>
      )}

      {/* MOBILE DRAWER FOR WORLD INFO */}
      {showWorldSidebar && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/50 flex justify-end animate-in fade-in duration-150">
          <div className="w-[360px] max-w-[90vw] h-full bg-[#EFE5D9] shadow-2xl flex flex-col animate-slide-in-right">
            <div className="p-3 bg-[#3E2723] text-[#FFFDF7] flex justify-between items-center">
              <span className="font-bold text-sm">Kho Nhân Vật & Thiết Lập</span>
              <button onClick={() => setShowWorldSidebar(false)} className="text-[#D7CCC8] hover:text-white p-1">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <WorldInfoPanel 
                currentNovelId={session.currentNovelId || ''}
                characters={session.characters} 
                onUpdateCharacters={(chars) => updateSession({ characters: chars })} 
                relationships={session.relationships} 
                onUpdateRelationships={(rels) => updateSession({ relationships: rels })} 
                notes={session.notes} 
                onUpdateNotes={(val) => updateSession({ notes: val })} 
                sheetUrl={session.sheetUrl} 
                onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
              />
            </div>
          </div>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex md:overflow-hidden overflow-visible min-h-0 relative">
        {/* INLINE LEFT SIDEBAR (Tablet/Laptop) */}
        {showDictSidebar && (
          <div className="hidden md:block w-80 border-r border-[#D7CCC8] bg-[#EFE5D9] shrink-0 h-full overflow-y-auto">
            <DictionarySidebar 
              currentNovelId={session.currentNovelId || ''}
              terms={session.customTerms} 
              onExportExcel={handleExportExcel} 
              onUpdateTerms={(novelTerms) => {
                  try {
                      const currentId = session.currentNovelId;
                      const otherTerms = (session.customTerms || []).filter(t => t.novelId && t.novelId !== currentId);
                      const merged = [...novelTerms, ...otherTerms];
                      updateSession({ customTerms: merged });
                      db.bulkSaveCustomTerms(merged).catch(err => {
                          console.error("App Sidebar Inline: db.bulkSaveCustomTerms failed", err);
                      });
                  } catch (err) {
                      console.error("App Sidebar Inline: onUpdateTerms caught error:", err);
                  }
              }} 
              sheetUrl={session.sheetUrl} 
              onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
              refreshTrigger={vpLoaded}
            />
          </div>
        )}

        {/* CENTER MAIN WORKSPACE */}
        <main className="flex-1 flex flex-col md:h-full h-auto md:overflow-hidden overflow-visible bg-[#F5E6D3] min-w-[320px]">
          <div className="flex-1 md:overflow-y-auto overflow-visible overflow-x-hidden scroll-smooth scrollbar-thin scrollbar-thumb-[#D7CCC8] scrollbar-track-transparent">
             <div className="flex flex-col gap-4 p-2.5 sm:p-4 max-w-7xl mx-auto w-full">
                
                {/* CARD 1: NGUỒN & THAM CHIẾU (MATCHING IMAGE 100%) */}
                {!isFocusMode && (
                  <div className="bg-[#FFFDF7] rounded-2xl border border-[#D7CCC8] shadow-sm p-3.5 space-y-3">
                    {/* Header Card 1 */}
                    <div className="flex flex-wrap justify-between items-center gap-2 border-b border-[#EFEBE9] pb-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="bg-[#3E2723] text-[#FFFDF7] text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide shadow-xs">
                          {mode === 'beta' ? 'NGUỒN & THAM CHIẾU (BETA)' : 'NGUỒN & THAM CHIẾU'}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-[#8D6E63] font-semibold">
                          <Layers size={13} />
                          <span>{segmentCount} đoạn văn</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => updateSession({ 
                              inputText: EXAMPLE_TEXT, 
                              deeplText: "Đường dài mới biết ngựa hay, ở lâu mới biết lòng dạ con người.",
                              preEditedText: mode === 'beta' ? "Đường dài mới biết sức ngựa, ngày lâu mới tỏ lòng người." : ""
                          })} 
                          className="text-xs text-[#8D6E63] hover:text-[#3E2723] flex items-center gap-1 font-medium"
                        >
                          <Quote size={13} /> Ví dụ
                        </button>
                        <button 
                          onClick={handleClearSession} 
                          disabled={!session.inputText && !session.deeplText && !session.preEditedText} 
                          className="text-xs text-[#8D6E63] hover:text-[#3E2723] flex items-center gap-1 font-medium disabled:opacity-40"
                        >
                          <Eraser size={13} /> Xóa
                        </button>
                      </div>
                    </div>

                    {/* Textarea Inputs */}
                    <div className="space-y-3">
                      <div>
                        <div className="text-[11px] font-bold text-[#8D6E63] uppercase tracking-wider mb-1">1. VĂN BẢN GỐC (TRUNG)</div>
                        <textarea
                          ref={textareaRef}
                          value={session.inputText}
                          onChange={(e) => updateSession({ inputText: e.target.value })}
                          placeholder="Nhập văn bản nguồn tiếng Trung..."
                          className="w-full min-h-[110px] max-h-[160px] p-3 text-lg font-serif-sc bg-[#FFFDF7]/40 border border-[#EFEBE9] rounded-xl outline-none focus:border-[#8D6E63] resize-y text-[#3E2723] leading-relaxed shadow-2xs"
                          spellCheck="false"
                        />
                      </div>

                      <div>
                        <div className="text-[11px] font-bold text-[#8D6E63] uppercase tracking-wider mb-1">2. BẢN DỊCH GG / DEEPL</div>
                        <textarea
                          value={session.deeplText}
                          onChange={(e) => updateSession({ deeplText: e.target.value })}
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
                          placeholder="Dán bản dịch GG/DeepL vào đây..."
                          className="w-full min-h-[90px] max-h-[140px] p-3 text-sm bg-[#FFFDF7]/40 border border-[#EFEBE9] rounded-xl outline-none focus:border-[#8D6E63] resize-y text-[#3E2723] leading-relaxed shadow-2xs"
                          spellCheck="false"
                        />
                      </div>

                      {mode === 'beta' && (
                        <div>
                          <div className="text-[11px] font-bold text-[#E64A19] uppercase tracking-wider mb-1 flex items-center gap-1">
                            3. BẢN EDIT SẴN <span className="bg-[#E64A19] text-white text-[8px] px-1.5 py-0.2 rounded-full uppercase font-bold">Beta</span>
                          </div>
                          <textarea
                            value={session.preEditedText || ''}
                            onChange={(e) => updateSession({ preEditedText: e.target.value })}
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
                            placeholder="Dán bản edit sẵn..."
                            className="w-full min-h-[90px] max-h-[140px] p-3 text-sm bg-[#FFFDF7]/40 border border-[#EFEBE9] rounded-xl outline-none focus:border-[#8D6E63] resize-y text-[#3E2723] leading-relaxed shadow-2xs font-medium"
                            spellCheck="false"
                          />
                        </div>
                      )}
                    </div>

                    {/* Footer Card 1 */}
                    <div className="flex justify-between items-center pt-1 border-t border-[#EFEBE9]">
                      <div className="text-xs font-medium text-[#8D6E63]">
                        {session.inputText.length} ký tự
                      </div>
                      <button
                        onClick={() => handleTranslate(false)}
                        disabled={session.status === AppStatus.LOADING || !session.inputText.trim()}
                        className="bg-[#3E2723] text-[#FFECB3] hover:bg-[#4E342E] disabled:bg-[#A1887F] disabled:cursor-not-allowed px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-md active:scale-95"
                      >
                        {session.status === AppStatus.LOADING ? (<><Loader2 className="animate-spin" size={15} /> Phân tích...</>) : 'Phân tích'}
                      </button>
                    </div>
                  </div>
                )}

                {/* ERROR */}
                {session.status === AppStatus.ERROR && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-sm flex gap-3 items-start shrink-0">
                        <AlertTriangle className="shrink-0 text-red-600" size={16} /> 
                        <div className="flex-1"><p className="font-bold mb-1">Đã xảy ra lỗi:</p><p className="opacity-90 leading-relaxed whitespace-pre-wrap">{session.error}</p></div>
                    </div>
                )}

                {/* CARD 2: BẢNG ĐỐI CHIẾU (MATCHING IMAGE 100%) */}
                {(session.result && (session.status === AppStatus.SUCCESS || session.status === AppStatus.LOADING)) ? (
                    <div className={isFocusMode ? "mt-1 w-full animate-fade-in" : "md:sticky md:top-2 z-10 w-full"}>
                        <div className={isFocusMode ? "h-auto md:h-[calc(100vh-4.2rem)]" : "h-auto md:h-[calc(100vh-4.5rem)]"}>
                            <TranslationOutput 
                                data={session.result} 
                                customTerms={session.customTerms} 
                                characters={session.characters} 
                                completedSegments={session.completedSegments || []}
                                onUpdateSegment={handleUpdateSegment} 
                                onUpdateAllSegments={handleUpdateAllSegments}
                                onToggleComplete={handleToggleComplete}
                                onSaveChapter={handleSaveChapter}
                                onUndo={handleUndo}
                                onRedo={handleRedo}
                                canUndo={undoStack.length > 0}
                                canRedo={redoStack.length > 0}
                                isFocusMode={isFocusMode}
                                onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                                onUpdateTerms={(novelTerms) => {
                                    try {
                                        const currentId = session.currentNovelId;
                                        const otherTerms = (session.customTerms || []).filter(t => t.novelId && t.novelId !== currentId);
                                        const merged = [...novelTerms, ...otherTerms];
                                        updateSession({ customTerms: merged });
                                        db.bulkSaveCustomTerms(merged).catch(err => {
                                            console.error("App Output: db.bulkSaveCustomTerms failed", err);
                                        });
                                    } catch (err) {
                                        console.error("App Output: onUpdateTerms caught error:", err);
                                    }
                                }}
                                onUpdateCharacters={(novelChars) => {
                                    try {
                                        const currentId = session.currentNovelId;
                                        const otherChars = (session.characters || []).filter(c => c.novelId && c.novelId !== currentId);
                                        const merged = [...novelChars, ...otherChars];
                                        updateSession({ characters: merged });
                                    } catch (err) {
                                        console.error("App Output: onUpdateCharacters caught error:", err);
                                    }
                                }}
                                currentNovelId={session.currentNovelId || ''}
                            />
                        </div>
                    </div>
                ) : (
                    session.status === AppStatus.IDLE && (
                        <div className="flex flex-col items-center justify-center text-[#BCAAA4] border-2 border-dashed border-[#D7CCC8] rounded-2xl py-12 bg-[#FFFDF7]/50">
                            <Layout size={32} className="mb-2 opacity-50"/>
                            <p className="text-xs font-semibold">Khu vực hiển thị kết quả đối chiếu</p>
                        </div>
                    )
                )}
             </div>
          </div>
        </main>

        {/* INLINE RIGHT SIDEBAR (Tablet/Laptop) */}
        {showWorldSidebar && (
          <div className="hidden md:block w-[360px] border-l border-[#D7CCC8] bg-[#EFE5D9] shrink-0 h-full overflow-y-auto">
            <WorldInfoPanel 
              currentNovelId={session.currentNovelId || ''}
              characters={session.characters} 
              onUpdateCharacters={(chars) => updateSession({ characters: chars })} 
              relationships={session.relationships} 
              onUpdateRelationships={(rels) => updateSession({ relationships: rels })} 
              notes={session.notes} 
              onUpdateNotes={(val) => updateSession({ notes: val })} 
              sheetUrl={session.sheetUrl} 
              onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
            />
          </div>
        )}
      </div>

      <HistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} history={history} onSelect={handleRestoreHistory} onDelete={deleteHistoryItem} onClearAll={() => setHistory([])} />

      <ChapterArchiveModal 
        isOpen={showChapters} 
        onClose={() => setShowChapters(false)} 
        chapters={currentNovelChapters} 
        customTerms={session.customTerms} 
        onSelectChapter={handleRestoreChapter} 
        onDeleteChapter={handleDeleteChapter} 
        onRenameChapter={handleRenameChapter} 
        onClearAll={handleClearAllChapters} 
      />

      <ShortcutModal 
        isOpen={showShortcuts} 
        onClose={() => setShowShortcuts(false)} 
        currentNovelId={session.currentNovelId || ''}
        onSelectNovel={(id) => updateSession({ currentNovelId: id })}
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
