
import React, { useState, useEffect, useRef } from 'react';
import { AppStatus, TranslationSession, HistoryItem, TranslationResponse } from './types';
import { translateText } from './services/geminiService';
import { vietphraseEngine } from './services/vietphraseService';
import { db } from './services/db'; // Import db service
import { TranslationOutput } from './components/TranslationOutput';
import { DictionarySidebar } from './components/DictionarySidebar';
import { WorldInfoPanel } from './components/WorldInfoPanel';
import { HistoryModal } from './components/HistoryModal'; 
import { Loader2, Sparkles, Eraser, Quote, Layout, History, AlertTriangle, Download, Layers } from 'lucide-react';

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

const ChocolateIcon = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path d="M5 3C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3H5ZM8 5V9H5V5H8ZM10 5H14V9H10V5ZM16 5H19V9H16V5ZM5 11H8V15H5V11ZM10 11H14V15H10V11ZM16 11H19V15H16V11ZM5 17H8V19H5V17ZM10 17H14V19H10V17ZM16 17H19V19H16V17Z" />
  </svg>
);

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
  name: `Bản dịch`,
  inputText: '',
  deeplText: '',
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
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [vpLoaded, setVpLoaded] = useState(false);

  // --- REFS ---
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- COMPUTED ---
  const segmentCount = session.inputText.trim() ? session.inputText.split(/\n/).length : 0;

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
}, []);

  // Fix lỗi QuotaExceededError khi lưu Session
  useEffect(() => {
    try {
        // Exclude customTerms from localStorage to save space
        const sessionToSave = { ...session, customTerms: [] };
        localStorage.setItem('chiVietSingleSession', JSON.stringify(sessionToSave));
    } catch (e) {
        console.warn("Storage Quota Exceeded for Session");
        // Nếu lỗi đầy bộ nhớ, thử lưu bản rút gọn (bỏ qua kết quả dịch để cứu nội dung input)
        if (session.result) {
            try {
                const leanSession = { ...session, customTerms: [], result: null };
                localStorage.setItem('chiVietSingleSession', JSON.stringify(leanSession));
            } catch (innerE) {
                console.error("Critical: Cannot save session even without result");
            }
        }
    }
  }, [session]);

  // Fix lỗi QuotaExceededError khi lưu History
  useEffect(() => {
    try {
        localStorage.setItem('chiVietHistory', JSON.stringify(history));
    } catch (e) {
        console.warn("Storage Quota Exceeded for History");
        // Nếu lỗi, thử cắt bớt lịch sử, chỉ giữ lại 20 mục gần nhất
        if (history.length > 20) {
            try {
                const leanHistory = history.slice(0, 20);
                localStorage.setItem('chiVietHistory', JSON.stringify(leanHistory));
            } catch (innerE) {
                // Nếu vẫn lỗi, giữ 5 mục
                 try {
                    const superLeanHistory = history.slice(0, 5);
                    localStorage.setItem('chiVietHistory', JSON.stringify(superLeanHistory));
                } catch (lastE) {}
            }
        }
    }
  }, [history]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // --- ACTIONS ---
  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const updateSession = (updates: Partial<TranslationSession>) => {
    setSession(prev => ({ ...prev, ...updates }));
  };

  const handleUpdateSegment = (index: number, newNatural: string) => {
    if (!session.result) return;
    const newSegments = [...session.result.segments];
    newSegments[index] = { ...newSegments[index], natural: newNatural.replace(/\n+$/, "") };
    const newResult = {
        ...session.result,
        segments: newSegments,
        naturalTranslation: newSegments.map(s => s.natural).join('\n')
    };
    
    updateSession({ result: newResult });

    if (session.currentHistoryId) {
      setHistory(prev => prev.map(item => 
        item.id === session.currentHistoryId 
          ? { ...item, result: newResult } 
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
  };

  const handleTranslate = async () => {
    if (!session.inputText.trim()) return;
    
    // --- BƯỚC 1: TÍNH TOÁN VIETPHRASE (LÀM TRƯỚC HOẶC SONG SONG VỚI GỌI API) ---
    // Mặc dù gọi là làm song song, nhưng do JS đơn luồng, ta sẽ tính toán Vietphrase
    // ngay lập tức (vì nó rất nhanh) để sẵn sàng merge khi AI trả về.
    const inputLines = session.inputText.split('\n');
    
    // Optimize: Convert customTerms to Map once
    const customMap = new Map<string, string>();
    session.customTerms.forEach(t => {
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
    updateSession({ status: AppStatus.LOADING, error: null, result: null, completedSegments: [], currentHistoryId: undefined });

    try {
      // --- BƯỚC 2: GỌI AI ---
      const data = await translateText(
        session.inputText, 
        session.customTerms,
        session.characters,
        session.relationships
      );
      
      // --- BƯỚC 3: MERGE KẾT QUẢ ---
      // Lấy kết quả 'natural' từ AI, nhưng GHI ĐÈ 'quick' bằng Vietphrase và 'deepl' bằng DeepL input
      const deeplLines = session.deeplText.split('\n');
      const mergedSegments = data.segments.map((seg, i) => ({
         ...seg,
         quick: vpSegments[i]?.quick || seg.quick, // Ưu tiên Vietphrase Engine
         deepl: deeplLines[i] || "" // Gắn DeepL theo index
      }));

      const mergedResult = {
         ...data,
         segments: mergedSegments,
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
        modelId: data.modelUsed
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
      result: sanitizeResult(item.result),
      status: AppStatus.SUCCESS,
      error: null,
      completedSegments: [],
      currentHistoryId: item.id
    });
    setShowHistory(false);
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="h-screen flex flex-col bg-[#F5E6D3] text-[#3E2723] font-sans overflow-hidden">
      
      {/* HEADER */}
      <header className="bg-[#4E342E] text-[#F5E6D3] border-b border-[#3E2723] h-14 flex items-center justify-between px-4 shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="text-[#FFECB3]">
              <ChocolateIcon size={24} />
            </div>
            <h1 className="text-2xl font-normal tracking-wide text-[#FFECB3] font-cute pt-1">Nâu</h1>
          </div>
        </div>
        
        {/* RIGHT CONTROLS */}
        <div className="flex items-center gap-2">
            {installPrompt && (
              <button onClick={handleInstallApp} className="flex items-center gap-1.5 text-[10px] font-bold text-[#3E2723] bg-[#FFECB3] hover:bg-[#FFD54F] px-3 py-1 rounded-full border border-[#FFCA28] transition-all shadow-sm animate-pulse">
                <Download size={14} />
                <span>Cài App</span>
              </button>
            )}
            <button onClick={() => setShowHistory(true)} className="flex items-center gap-1.5 text-[10px] font-medium text-[#D7CCC8] hover:text-white hover:bg-[#5D4037] px-2 py-1 rounded-full border border-[#5D4037] transition-colors">
               <History size={12} />
               <span>Lịch sử</span>
            </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <div className="w-80 border-r border-[#D7CCC8] bg-[#EFE5D9] shrink-0">
            <DictionarySidebar 
                terms={session.customTerms} 
                onUpdateTerms={(terms) => {
                    updateSession({ customTerms: terms });
                    db.bulkSaveCustomTerms(terms);
                }} 
                sheetUrl={session.sheetUrl} 
                onUpdateSheetUrl={(url) => updateSession({ sheetUrl: url })} 
                refreshTrigger={vpLoaded}            />
        </div>

        {/* CENTER MAIN CONTENT */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F5E6D3] min-w-[320px]">
          <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth scrollbar-thin scrollbar-thumb-[#D7CCC8] scrollbar-track-transparent">
             <div className="flex flex-col px-2 pb-2">
                
                {/* INPUT AREA */}
                <div className="mt-2 bg-white rounded-xl shadow-sm border border-[#D7CCC8] overflow-hidden transition-all focus-within:ring-2 focus-within:ring-[#8D6E63]/20 focus-within:border-[#8D6E63]/50 mb-2 flex flex-col">
                    <div className="flex justify-between items-center bg-[#EFEBE9]/50 px-3 py-1.5 border-b border-[#EFEBE9]">
                        <div className="flex items-center gap-2">
                            <span className="bg-[#5D4037] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">Nguồn</span>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-[#8D6E63]">
                                <Layers size={10} />
                                <span>{segmentCount} đoạn văn</span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => updateSession({ inputText: EXAMPLE_TEXT, deeplText: "Đường dài mới biết ngựa hay, ở lâu mới biết lòng dạ con người." })} className="text-[10px] text-[#8D6E63] hover:text-[#3E2723] px-2 py-1 rounded hover:bg-[#D7CCC8] flex items-center gap-1"><Quote size={10} /> Ví dụ</button>
                            <button onClick={() => updateSession({ inputText: '', deeplText: '', result: null, status: AppStatus.IDLE })} disabled={!session.inputText && !session.deeplText} className="text-[10px] text-[#8D6E63] hover:text-[#3E2723] px-2 py-1 rounded hover:bg-[#D7CCC8] flex items-center gap-1 disabled:opacity-50"><Eraser size={10} /> Xóa</button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 flex-1 min-h-[140px] divide-x divide-[#EFEBE9]">
                        <textarea
                            ref={textareaRef}
                            value={session.inputText}
                            onChange={(e) => updateSession({ inputText: e.target.value })}
                            placeholder="Nhập văn bản nguồn (Trung)..."
                            className="flex-1 p-3 text-lg font-serif-sc bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed"
                            spellCheck="false"
                        />
                        <textarea
                            value={session.deeplText}
                            onChange={(e) => updateSession({ deeplText: e.target.value })}
                            placeholder="Dán bản dịch DeepL vào đây..."
                            className="flex-1 p-3 text-sm bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed"
                            spellCheck="false"
                        />
                    </div>

                    <div className="flex justify-between items-center p-2 border-t border-[#EFEBE9] bg-[#FAFAFA]">
                        <div className="flex items-center gap-4">
                            <div className="text-[10px] font-medium transition-colors text-[#A1887F]">
                                {session.inputText.length} ký tự
                            </div>
                        </div>

                        <button
                            onClick={handleTranslate}
                            disabled={session.status === AppStatus.LOADING || !session.inputText.trim()}
                            className="bg-[#3E2723] text-[#FFECB3] hover:bg-[#4E342E] disabled:bg-[#A1887F] disabled:cursor-not-allowed px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
                        >
                            {session.status === AppStatus.LOADING ? (<><Loader2 className="animate-spin" size={14} /> Dịch...</>) : (<><Sparkles size={14} /> Dịch Ngay</>)}
                        </button>
                    </div>
                </div>

                {/* ERROR */}
                {session.status === AppStatus.ERROR && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm flex gap-3 items-start shrink-0 mb-6">
                        <AlertTriangle className="shrink-0 text-red-600" size={16} /> 
                        <div className="flex-1"><p className="font-bold mb-1">Đã xảy ra lỗi:</p><p className="opacity-90 leading-relaxed whitespace-pre-wrap">{session.error}</p></div>
                    </div>
                )}

                {/* RESULT */}
                {(session.result && (session.status === AppStatus.SUCCESS || session.status === AppStatus.LOADING)) ? (
                    <div className="sticky top-2 z-10">
                        <div className="h-[calc(100vh-4.5rem)]">
                            <TranslationOutput 
                                data={session.result} 
                                customTerms={session.customTerms} 
                                characters={session.characters} 
                                completedSegments={session.completedSegments || []}
                                onUpdateSegment={handleUpdateSegment} 
                                onToggleComplete={handleToggleComplete}
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
        <div className="w-[360px] border-l border-[#D7CCC8] bg-[#EFE5D9] shrink-0">
            <WorldInfoPanel 
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

      <HistoryModal isOpen={showHistory} onClose={() => setShowHistory(false)} history={history} onSelect={handleRestoreHistory} onDelete={deleteHistoryItem} onClearAll={() => setHistory([])} />
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
