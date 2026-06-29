
import React, { useState, useEffect, useRef } from 'react';
import { AppStatus, TranslationSession, HistoryItem, TranslationResponse } from './types';
import { translateText } from './services/geminiService';
import { vietphraseEngine } from './services/vietphraseService';
import { db } from './services/db'; // Import db service
import { TranslationOutput } from './components/TranslationOutput';
import { DictionarySidebar } from './components/DictionarySidebar';
import { WorldInfoPanel } from './components/WorldInfoPanel';
import { HistoryModal } from './components/HistoryModal'; 
import { AuthPanel } from './components/AuthPanel';
import { NovelSelector } from './components/NovelSelector';
import { Loader2, Sparkles, Eraser, Quote, Layout, History, AlertTriangle, Layers, PenLine } from 'lucide-react';

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
    if (tLines.length >= validRLines.length * 0.7 || tLines.length > 2) {
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

  // --- ACTIONS ---

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
      let mergedSegments = [];
      const hasPreEdited = !!(session.preEditedText && session.preEditedText.trim());

      if (mode === 'beta' && hasPreEdited) {
         // Align pre-edited text to source lines
         const preEditedLines = alignTranslation(inputLines, session.preEditedText || "");
         
         // Align GG/DeepL text to source lines if it was provided
         const hasDeepl = !!(session.deeplText && session.deeplText.trim());
         const deeplLines = hasDeepl ? alignTranslation(inputLines, session.deeplText) : [];

         mergedSegments = inputLines.map((line, i) => {
             // In Beta mode:
             // - If GG/DeepL is NOT pasted, we use the AI natural translation as "deepl" reference
             // - If GG/DeepL IS pasted, we use the aligned GG/DeepL as "deepl" reference
             let refDeepl = "";
             if (hasDeepl) {
                 refDeepl = deeplLines[i] || "";
             } else {
                 refDeepl = (data.segments && data.segments[i]) ? data.segments[i].natural : "";
             }

             return {
                 source: line,
                 natural: preEditedLines[i] || "", // Main translation is replaced with aligned pre-edited text
                 quick: vpSegments[i]?.quick || ((data.segments && data.segments[i]) ? data.segments[i].quick : ""),
                 deepl: refDeepl
             };
         });
      } else {
         // Standard Edit Mode
         const deeplLines = alignTranslation(inputLines, session.deeplText);
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
      preEditedText: item.result?.naturalTranslation || "",
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
              <PenLine size={24} />
            </div>
            <h1 style={{ fontFamily: '"Nunito", sans-serif' }} className="text-2xl font-extrabold tracking-wide text-[#FFECB3] pt-1">Edit</h1>
          </div>

          {/* Segmented Mode Control */}
          <div className="flex bg-[#3E2723] p-0.5 rounded-lg border border-[#5D4037] ml-2">
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${mode === 'edit' ? 'bg-[#FFECB3] text-[#3E2723] shadow-sm' : 'text-[#D7CCC8] hover:text-[#FFECB3]'}`}
            >
              Chế độ Edit
            </button>
            <button
              onClick={() => setMode('beta')}
              className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${mode === 'beta' ? 'bg-[#FFECB3] text-[#3E2723] shadow-sm' : 'text-[#D7CCC8] hover:text-[#FFECB3]'}`}
            >
              Chế độ Beta
              <span className={`text-[8px] font-mono font-black px-1 rounded-full uppercase bg-[#E64A19] text-white`}>New</span>
            </button>
          </div>
        </div>
        
        {/* RIGHT CONTROLS */}
        <div className="flex items-center gap-2">
            <NovelSelector 
              currentNovelId={session.currentNovelId || ''} 
              onSelectNovel={(id) => updateSession({ currentNovelId: id })} 
            />
            <AuthPanel />
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
                currentNovelId={session.currentNovelId || ''}
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
                            <span className="bg-[#5D4037] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                                {mode === 'beta' ? 'Nguồn & Tham chiếu (Beta)' : 'Nguồn & Tham chiếu'}
                            </span>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-[#8D6E63]">
                                <Layers size={10} />
                                <span>{segmentCount} đoạn văn</span>
                            </div>
                        </div>
                        <div className="flex gap-2">
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
                                onClick={() => updateSession({ inputText: '', deeplText: '', preEditedText: '', result: null, status: AppStatus.IDLE })} 
                                disabled={!session.inputText && !session.deeplText && !session.preEditedText} 
                                className="text-[10px] text-[#8D6E63] hover:text-[#3E2723] px-2 py-1 rounded hover:bg-[#D7CCC8] flex items-center gap-1 disabled:opacity-50"
                            >
                                <Eraser size={10} /> Xóa
                            </button>
                        </div>
                    </div>

                    <div className={`grid ${mode === 'beta' ? 'grid-cols-3' : 'grid-cols-2'} flex-1 min-h-[140px] divide-x divide-[#EFEBE9]`}>
                        <div className="flex flex-col flex-1">
                            <div className="text-[9px] font-bold text-[#8D6E63] uppercase tracking-wider px-3 pt-1.5 bg-[#FAFAFA]/40">1. Văn bản gốc (Trung)</div>
                            <textarea
                                ref={textareaRef}
                                value={session.inputText}
                                onChange={(e) => updateSession({ inputText: e.target.value })}
                                placeholder="Nhập văn bản nguồn (Trung)..."
                                className="flex-1 p-3 text-lg font-serif-sc bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed"
                                spellCheck="false"
                            />
                        </div>
                        <div className="flex flex-col flex-1">
                            <div className="text-[9px] font-bold text-[#8D6E63] uppercase tracking-wider px-3 pt-1.5 bg-[#FAFAFA]/40">2. Bản dịch GG / DeepL {mode === 'beta' && <span className="text-[8px] font-normal lowercase text-[#BCAAA4]">(không bắt buộc)</span>}</div>
                            <textarea
                                value={session.deeplText}
                                onChange={(e) => updateSession({ deeplText: e.target.value })}
                                placeholder="Dán bản dịch GG/DeepL vào đây..."
                                className="flex-1 p-3 text-sm bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed"
                                spellCheck="false"
                            />
                        </div>
                        {mode === 'beta' && (
                            <div className="flex flex-col flex-1">
                                <div className="text-[9px] font-bold text-[#E64A19] uppercase tracking-wider px-3 pt-1.5 bg-[#FAFAFA]/40 flex items-center gap-1">3. Bản edit sẵn <span className="bg-[#E64A19] text-white text-[7px] px-1 rounded-full uppercase">Beta</span></div>
                                <textarea
                                    value={session.preEditedText || ''}
                                    onChange={(e) => updateSession({ preEditedText: e.target.value })}
                                    placeholder="Dán bản edit sẵn vào đây..."
                                    className="flex-1 p-3 text-sm bg-transparent border-none outline-none resize-none placeholder:text-[#BCAAA4] leading-relaxed font-medium text-[#4E342E]"
                                    spellCheck="false"
                                />
                            </div>
                        )}
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
                            {session.status === AppStatus.LOADING ? (<><Loader2 className="animate-spin" size={14} /> Phân tích...</>) : (<><Sparkles size={14} /> Phân tích</>)}
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
