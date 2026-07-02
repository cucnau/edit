
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TranslationResponse, VocabItem, CustomTerm, Character } from '../types';
import { Copy, TableProperties, Check, Info, X, Users, ClipboardList, CheckCircle2, FileDown, BookOpen } from 'lucide-react';
import { vietphraseEngine } from '../services/vietphraseService';

interface TranslationOutputProps {
  data: TranslationResponse;
  customTerms?: CustomTerm[];
  characters?: Character[];
  completedSegments?: number[];
  onUpdateSegment?: (index: number, newNatural: string) => void;
  onToggleComplete?: (index: number) => void;
  onSaveChapter?: (name: string) => void;
}

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EditableSegment = ({ 
    text, 
    onUpdate 
}: { 
    text: string; 
    onUpdate: (val: string) => void 
}) => {
    const [localText, setLocalText] = useState(text);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const debounceTimeout = useRef<NodeJS.Timeout>();
    
    useEffect(() => {
        setLocalText(text);
    }, [text]);
    
    const adjustHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = '0px';
            const scrollHeight = textareaRef.current.scrollHeight;
            textareaRef.current.style.height = `${scrollHeight}px`;
        }
    };

    useEffect(() => {
        adjustHeight();
        const timer = setTimeout(adjustHeight, 10);
        window.addEventListener('resize', adjustHeight);
        return () => {
            window.removeEventListener('resize', adjustHeight);
            clearTimeout(timer);
        };
    }, [localText]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setLocalText(val);

        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }
        debounceTimeout.current = setTimeout(() => {
            onUpdate(val);
        }, 500);
    };

    const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }
        onUpdate(e.target.value);
    };

    return (
        <textarea
            ref={textareaRef}
            value={localText}
            onChange={handleChange}
            onBlur={handleBlur}
            className="w-full bg-transparent border-none outline-none resize-none overflow-hidden p-0 text-[#4E342E] leading-[1.2] text-[15px] focus:ring-0 m-0 block whitespace-normal min-h-0"
            style={{ fontWeight: 400, display: 'block', margin: 0 }}
            rows={1}
            spellCheck={false}
        />
    );
};

const SegmentCopyBtn = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={handleCopy}
            className="absolute top-0 right-0 p-1 rounded-full bg-white/70 hover:bg-white text-[#A1887F] hover:text-[#3E2723] transition-all opacity-0 group-hover/row:opacity-100 shadow-sm border border-[#D7CCC8] z-10"
            title="Sao chép đoạn này"
        >
            {copied ? <Check size={10} className="text-[#5D4037]" /> : <Copy size={10} />}
        </button>
    );
};

export const TranslationOutput: React.FC<TranslationOutputProps> = ({ 
    data, 
    customTerms = [], 
    characters = [],
    completedSegments = [],
    onUpdateSegment,
    onToggleComplete,
    onSaveChapter
}) => {
  const [showNamingModal, setShowNamingModal] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [showSaveArchiveModal, setShowSaveArchiveModal] = useState(false);
  const [archiveChapterName, setArchiveChapterName] = useState('');
  const [vpVersion, setVpVersion] = useState(0);
  const [activeVocab, setActiveVocab] = useState<{ 
    item: VocabItem; 
    position: { x: number; y: number }; 
    side: 'top' | 'bottom';
    type?: 'char' | 'custom' | 'ai' 
  } | null>(null);
  const [copiedMode, setCopiedMode] = useState<'all' | 'parallel' | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Subscribe to vietphrase changes to trigger re-renders
  useEffect(() => {
    return vietphraseEngine.subscribe(() => {
      setVpVersion(prev => prev + 1);
    });
  }, []);

  // Combined terms map for Vietphrase translate
  const customMap = React.useMemo(() => {
    const map = new Map<string, string>();
    customTerms.forEach(t => {
      if (t.term && t.meaning) {
        map.set(t.term.trim(), t.meaning.trim());
      }
    });
    characters.forEach(c => {
      if (c.chineseName && c.vietName) {
        map.set(c.chineseName.trim(), c.vietName.trim());
      }
    });
    return map;
  }, [customTerms, characters]);

  const copyToClipboard = (text: string, mode: 'all' | 'parallel') => {
    navigator.clipboard.writeText(text.trim());
    setCopiedMode(mode);
    setTimeout(() => setCopiedMode(null), 2000);
  };

  const hasSegments = data.segments && data.segments.length > 0;
  
  // SỬA ĐỔI: Dùng .join('\n') để dính sát nhau
  const getParallelText = () => data.segments.map(seg => `${(seg.source || '').trim()}\n${(seg.natural || '').trim()}`).join('\n');
  const getNaturalText = () => data.segments.map(seg => (seg.natural || '').trim()).join('\n');

  const performWordExport = (fileName: string) => {
    if (!data.segments || data.segments.length === 0) return;

    let tableRowsHtml = "";
    data.segments.forEach((seg, idx) => {
      const cleanSource = (seg.source || '').trim();
      const cleanNatural = (seg.natural || '').trim();
      const cleanDeepl = (seg.deepl || '').trim();
      const cleanQuick = (vietphraseEngine.translate(cleanSource, customMap) || '').trim();

      if (!cleanSource && !cleanNatural) return;

      tableRowsHtml += `
        <tr>
          <td style="border: 1px solid #D7CCC8; padding: 8px; vertical-align: top; font-family: 'SimSun', serif; font-size: 11pt; background-color: #FFFDF7; width: 22%;">${cleanSource}</td>
          <td style="border: 1px solid #D7CCC8; padding: 8px; vertical-align: top; font-family: 'Times New Roman', serif; font-size: 10.5pt; color: #8D6E63; width: 23%;">${cleanQuick}</td>
          <td style="border: 1px solid #D7CCC8; padding: 8px; vertical-align: top; font-family: 'Times New Roman', serif; font-size: 10.5pt; color: #A1887F; width: 23%;">${cleanDeepl}</td>
          <td style="border: 1px solid #D7CCC8; padding: 8px; vertical-align: top; font-family: 'Times New Roman', serif; font-size: 11pt; color: #3E2723; width: 32%;">${cleanNatural}</td>
        </tr>
      `;
    });

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset="utf-8">
        <title>${fileName}</title>
        <style>
          body { font-family: "Times New Roman", Times, serif; font-size: 11pt; color: #333333; }
          table { border-collapse: collapse; width: 100%; margin-top: 15px; }
          th { background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8; padding: 10px 8px; font-weight: bold; text-align: left; font-size: 11pt; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th style="width: 22%; background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8;">Raw</th>
              <th style="width: 23%; background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8;">Vietphrase</th>
              <th style="width: 23%; background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8;">GG/DL</th>
              <th style="width: 32%; background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8;">Bản edit</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleConfirmExport = () => {
    let name = exportFileName.trim();
    if (!name) {
      name = `Bang_doi_chieu_${new Date().toISOString().slice(0, 10)}`;
    }
    if (!name.endsWith('.doc') && !name.endsWith('.docx')) {
      name += '.doc';
    }
    performWordExport(name);
    setShowNamingModal(false);
  };

  const exportToWord = () => {
    if (!data.segments || data.segments.length === 0) return;
    const defaultName = `Bang_doi_chieu_${new Date().toISOString().slice(0, 10)}`;
    setExportFileName(defaultName);
    setShowNamingModal(true);
  };

  const handleConfirmSaveArchive = () => {
    let name = archiveChapterName.trim();
    if (!name) {
      name = `Chương_${new Date().toISOString().slice(0, 10)}`;
    }
    onSaveChapter?.(name);
    setShowSaveArchiveModal(false);
  };

  const saveToArchive = () => {
    if (!data.segments || data.segments.length === 0) return;
    const defaultName = `Chương_${new Date().toISOString().slice(0, 10)}`;
    setArchiveChapterName(defaultName);
    setShowSaveArchiveModal(true);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) setActiveVocab(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleVocabClick = (event: React.MouseEvent, vocab: VocabItem, type: 'char' | 'custom' | 'ai' = 'ai') => {
     event.stopPropagation();
     const rect = event.currentTarget.getBoundingClientRect();
     const viewportHeight = window.innerHeight;
     const spaceBelow = viewportHeight - rect.bottom;
     
     const side = spaceBelow < 260 ? 'top' : 'bottom';
     
     let x = rect.left + rect.width / 2;
     let y = side === 'bottom' 
        ? rect.bottom + 10
        : rect.top - 10;

     if (x < 130) x = 130;
     if (x > window.innerWidth - 130) x = window.innerWidth - 130;
     
     setActiveVocab({ item: vocab, position: { x, y }, side, type });
  };

  const { pattern, termMap } = React.useMemo(() => {
    const map = new Map<string, VocabItem & { type: 'char' | 'custom' | 'ai' }>();
    const aiVocab = data.vocabulary || [];

    const allTerms = [
        ...characters.map(c => ({ term: c.chineseName, item: c, type: 'char' as const })),
        ...customTerms.map(c => ({ term: c.term, item: c, type: 'custom' as const })),
        ...aiVocab.map(v => ({ term: v.term, item: v, type: 'ai' as const }))
    ]
    .filter(t => t.term && t.term.trim().length > 0);

    // Sort by length descending
    allTerms.sort((a, b) => b.term.length - a.term.length);

    allTerms.forEach(({ term, item, type }) => {
        if (!map.has(term)) {
            let vocabItem: VocabItem;
            if (type === 'char') {
                 const c = item as Character;
                 vocabItem = { term: c.chineseName, pinyin: "Nhân vật", hanViet: c.vietName, meaning: c.vietName, explanation: `(Ngôi 3: ${c.pronouns}) ${c.description}` };
            } else if (type === 'custom') {
                 const c = item as CustomTerm;
                 vocabItem = { term: c.term, pinyin: "Từ điển riêng", hanViet: "Custom", meaning: c.meaning, explanation: "Từ vựng khớp với danh sách từ điển riêng của bạn." };
            } else {
                 vocabItem = item as VocabItem;
            }
            map.set(term, { ...vocabItem, type });
        }
    });

    const uniqueTerms = Array.from(map.keys());
    if (uniqueTerms.length === 0) return { pattern: null, termMap: map };
    
    const pattern = new RegExp(`(${uniqueTerms.map(t => escapeRegExp(t)).join('|')})`, 'g');
    
    return { pattern, termMap: map };
  }, [characters, customTerms, data.vocabulary]);

  const renderSourceWithHighlight = (text: string) => {
    const trimmedText = (text || "").trim();
    if (!trimmedText) return null;
    if (!pattern) return trimmedText;

    return trimmedText.split(pattern).map((part, i) => {
        if (!part) return null;
        const match = termMap.get(part);

        if (match) {
             if (match.type === 'char') {
                 return <span key={i} onClick={(e) => handleVocabClick(e, match, 'char')} className="border-b border-dashed border-[#5D4037] bg-[#EFEBE9] cursor-pointer hover:bg-[#D7CCC8] transition-colors rounded-sm px-0.5 text-[#3E2723] font-bold leading-none inline-block">{part}</span>;
             } else if (match.type === 'custom') {
                 return <span key={i} onClick={(e) => handleVocabClick(e, match, 'custom')} className="border-b border-dashed border-[#5D4037] bg-[#EFEBE9] cursor-pointer hover:bg-[#D7CCC8] transition-colors rounded-sm px-0.5 text-[#3E2723] font-bold leading-none inline-block">{part}</span>;
             } else if (match.type === 'ai') {
                 return <span key={i} onClick={(e) => handleVocabClick(e, match, 'ai')} className="border-b-2 border-dashed border-[#FBC02D] bg-[#FFF9C4] cursor-pointer hover:bg-[#FFF176] transition-colors rounded-sm px-0.5 text-[#3E2723] font-bold leading-none inline-block shadow-[inset_0_-2px_0_rgba(251,192,45,0.2)]">{part}</span>;
             }
        }
        return part;
    });
  };

  return (
    <div className="bg-white flex flex-col h-full overflow-hidden relative border border-[#D7CCC8] rounded-xl shadow-sm">
      <div className="shrink-0 bg-white">
          <div className="flex items-center justify-between bg-[#EFEBE9] px-3 py-1 border-b border-[#D7CCC8]">
             <div className="flex items-center gap-1.5 text-[#3E2723] font-bold text-[10px] uppercase tracking-tight"><TableProperties size={12} /><span>Bảng đối chiếu</span></div>
             <div className="flex items-center gap-1.5">
                <button onClick={() => copyToClipboard(getParallelText(), 'parallel')} className="flex items-center gap-1 text-[9px] font-bold text-[#5D4037] hover:text-[#3E2723] bg-white border border-[#D7CCC8] px-2 py-0.5 rounded hover:bg-[#D7CCC8] transition-colors shadow-sm">{copiedMode === 'parallel' ? <Check size={10} /> : <ClipboardList size={10} />}<span>Edit & Raw</span></button>
                <button onClick={() => copyToClipboard(getNaturalText(), 'all')} className="flex items-center gap-1 text-[9px] font-bold text-[#8D6E63] hover:text-[#3E2723] bg-white border border-[#D7CCC8] px-2 py-0.5 rounded hover:bg-[#D7CCC8] transition-colors shadow-sm">{copiedMode === 'all' ? <Check size={10} /> : <Copy size={10} />}<span>Edit</span></button>
                <button onClick={exportToWord} className="flex items-center gap-1 text-[9px] font-bold text-[#3E2723] hover:text-white hover:bg-[#5D4037] bg-white border border-[#D7CCC8] px-2 py-0.5 rounded hover:bg-[#5D4037] transition-colors shadow-sm"><FileDown size={10} /><span>Xuất Word</span></button>
                {onSaveChapter && (
                   <button onClick={saveToArchive} className="flex items-center gap-1 text-[9px] font-bold text-[#5D4037] hover:text-white hover:bg-[#8D6E63] bg-white border border-[#D7CCC8] px-2 py-0.5 rounded hover:bg-[#8D6E63] transition-colors shadow-sm"><BookOpen size={10} /><span>Lưu Kho</span></button>
                )}
             </div>
          </div>
          {hasSegments && (
             <div className="flex w-full bg-[#EFEBE9] text-[#5D4037] text-[9px] font-bold uppercase tracking-wider shadow-sm border-t border-[#D7CCC8]">
                 <div className="w-[45%] p-1 border-r border-[#D7CCC8] pl-2">Nguồn</div>
                 <div className="w-[55%] p-1 pl-2">Bản edit</div>
             </div>
          )}
      </div>

      <div className="flex-1 overflow-y-auto bg-white scrollbar-thin scrollbar-thumb-[#D7CCC8] scrollbar-track-transparent pb-4">
        {hasSegments ? (
             <table className="w-full text-left border-collapse table-fixed m-0 p-0 border-none">
                <colgroup><col className="w-[45%]" /><col className="w-[55%]" /></colgroup>
                <tbody className="divide-y divide-[#EFEBE9]">
                   {data.segments.map((seg, idx) => {
                      const isDone = completedSegments.includes(idx);
                      const cleanSource = (seg.source || '').trim();
                      const cleanNatural = (seg.natural || '').trim();
                      const cleanDeepl = (seg.deepl || '').trim();
                      const cleanQuick = (vietphraseEngine.translate(cleanSource, customMap) || '').trim();

                      if (!cleanSource && !cleanNatural) return null;

                      return (
                        <tr key={idx} className={`${isDone ? 'bg-[#EFEBE9]/40 hover:bg-[#D7CCC8]/30' : 'hover:bg-[#F5F5F5]/40'} transition-colors group/row border-none`}>
                           <td className={`py-0 px-2 align-top border-r border-[#EFEBE9] relative ${isDone ? 'opacity-80' : 'bg-[#FFFDF7]/30'}`}>
                              <div className="flex flex-col py-0.5">
                                <div className="text-[14.5px] font-serif-sc leading-[1.2] text-[#3E2723] m-0 whitespace-normal break-words">
                                   <button 
                                      onClick={() => onToggleComplete?.(idx)}
                                      className={`inline-flex items-center justify-center min-w-[16px] h-[16px] mr-1 transition-all select-none align-middle transform -translate-y-[1px] rounded ${isDone ? 'text-[#5D4037] scale-110' : 'text-[#A1887F]/30 hover:text-[#3E2723] hover:scale-110'}`}
                                   >
                                       {isDone ? <CheckCircle2 size={12} /> : <span className="text-[9px] font-bold">{idx + 1}.</span>}
                                   </button>
                                   {renderSourceWithHighlight(cleanSource)}
                                </div>
                                {cleanQuick && (
                                  <div className="text-[10px] text-[#8D6E63] leading-[1.1] opacity-70 italic pl-[18px] -mt-0.5 break-words">
                                    {cleanQuick}
                                  </div>
                                )}
                              </div>
                           </td>
                           <td className="py-0 px-2 align-top relative pr-6 border-none">
                              <div className="flex flex-col py-0.5">
                                  <EditableSegment text={cleanNatural} onUpdate={(val) => onUpdateSegment?.(idx, val)} />
                                  {cleanDeepl && (
                                    <div className="text-[8.5px] text-[#A1887F] leading-[1.1] italic opacity-60 -mt-0.5 break-words"><span className="font-bold mr-1 opacity-80 not-italic text-[#5D4037]">GG/DL:</span>{cleanDeepl}</div>
                                  )}
                              </div>
                              <SegmentCopyBtn text={cleanNatural} />
                           </td>
                        </tr>
                      );
                   })}
                </tbody>
             </table>
        ) : (
             <div className="p-3"><p className="text-[15px] leading-[1.2] text-[#3E2723] whitespace-normal">{data.naturalTranslation.trim()}</p></div>
        )}
      </div>

      {activeVocab && createPortal(
        <div 
          ref={popupRef} 
          style={{ 
            left: activeVocab.position.x, 
            top: activeVocab.position.y, 
            transform: activeVocab.side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' 
          }} 
          className="fixed z-50 w-[240px] bg-[#FFFDF7] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)] border border-[#D7CCC8] animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
        >
            {activeVocab.side === 'bottom' ? (
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#FFFDF7] border-l border-t border-[#D7CCC8] rotate-45"></div>
            ) : (
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#FFFDF7] border-r border-b border-[#D7CCC8] rotate-45"></div>
            )}
            <div className="p-3">
                <div className="flex justify-between items-start mb-1">
                    <div>
                        <h3 className="text-base font-serif-sc font-bold text-[#3E2723] leading-none mb-1 flex items-center gap-1.5">{activeVocab.type === 'char' && <Users size={12} className="text-[#8D6E63]" />}{activeVocab.item.term}</h3>
                        <div className="flex items-center gap-1.5"><span className="bg-[#EFEBE9] text-[#5D4037] px-1 py-0.5 rounded text-[8px] font-mono border border-[#D7CCC8]">{activeVocab.item.pinyin}</span></div>
                    </div>
                    <button onClick={() => setActiveVocab(null)} className="text-[#A1887F] hover:text-[#3E2723] p-1 rounded-full hover:bg-[#EFEBE9]"><X size={12} /></button>
                </div>
                <div className="space-y-1.5">
                    <div className="flex justify-between items-baseline border-b border-[#EFEBE9] pb-0.5"><span className="text-[7px] font-bold text-[#8D6E63] uppercase tracking-wider">{activeVocab.type === 'char' ? 'Tên Việt' : 'Hán Việt'}</span><span className="text-xs text-[#3E2723] font-medium">{activeVocab.item.hanViet}</span></div>
                    <div><div className="text-[7px] font-bold text-[#8D6E63] uppercase tracking-wider mb-0.5">{activeVocab.type === 'char' ? 'Tên hiển thị' : 'Nghĩa'}</div><div className="text-xs font-bold text-[#3E2723] bg-[#FFF8E1] p-1 rounded border-l-2 border-[#5D4037]">{activeVocab.item.meaning}</div></div>
                    {activeVocab.item.explanation && (<div><div className="text-[7px] font-bold text-[#8D6E63] uppercase tracking-wider mb-0.5 flex items-center gap-1"><Info size={8} /> Chi tiết</div><div className="text-[10px] text-[#5D4037] italic leading-tight bg-white border border-[#EFEBE9] p-1 rounded">{activeVocab.item.explanation}</div></div>)}
                </div>
            </div>
        </div>,
        document.body
      )}

      {showNamingModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl shadow-[0_20px_50px_rgba(62,39,35,0.3)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#EFEBE9] px-4 py-3 border-b border-[#D7CCC8] flex items-center justify-between">
              <span className="text-xs font-bold text-[#3E2723] uppercase tracking-wider flex items-center gap-1.5">
                <FileDown size={14} className="text-[#8D6E63]" />
                <span>Đặt tên file Word</span>
              </span>
              <button 
                onClick={() => setShowNamingModal(false)}
                className="text-[#A1887F] hover:text-[#3E2723] p-1 rounded-full hover:bg-[#D7CCC8]/30 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-5">
              <label className="block text-[11px] font-bold text-[#8D6E63] uppercase tracking-wider mb-2">
                Tên file (hệ thống sẽ tự động thêm .doc):
              </label>
              <input
                type="text"
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder="VD: chuong_153_doi_chieu"
                className="w-full bg-white border border-[#D7CCC8] rounded px-3 py-2 text-[#3E2723] text-sm outline-none focus:border-[#8D6E63] focus:ring-1 focus:ring-[#8D6E63] transition-all font-medium"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmExport();
                  }
                }}
              />
              <p className="text-[10px] text-[#A1887F] mt-2 italic">
                Bảng sẽ xuất ra Word gồm 4 cột đối chiếu: Nguồn, Vietphrase, GG/DL và Bản edit.
              </p>
            </div>
            
            <div className="bg-[#F5F2F0] px-5 py-3 border-t border-[#D7CCC8] flex justify-end gap-2">
              <button
                onClick={() => setShowNamingModal(false)}
                className="px-3.5 py-1.5 rounded text-xs font-bold text-[#5D4037] hover:bg-[#D7CCC8]/30 transition-all border border-transparent"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmExport}
                className="px-4 py-1.5 rounded bg-[#5D4037] hover:bg-[#3E2723] text-white text-xs font-bold transition-all shadow-sm"
              >
                Xuất file
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showSaveArchiveModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#3E2723]/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#FFFDF7] rounded-xl border border-[#D7CCC8] shadow-2xl w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-[#D7CCC8] bg-[#EFE5D9] flex justify-between items-center">
              <div className="flex items-center gap-2 text-[#3E2723] font-bold text-sm">
                <BookOpen size={16} />
                <span>Lưu chương vào kho lưu trữ</span>
              </div>
              <button onClick={() => setShowSaveArchiveModal(false)} className="text-[#A1887F] hover:text-[#3E2723] p-1 rounded-full transition-colors">
                <X size={16} />
              </button>
            </div>
            
            <div className="p-5">
              <label className="block text-xs font-bold text-[#5D4037] mb-2 uppercase tracking-wide">Tên chương để lưu trữ</label>
              <input
                type="text"
                value={archiveChapterName}
                onChange={(e) => setArchiveChapterName(e.target.value)}
                placeholder="VD: Chương 123: Tiêu đề chương"
                className="w-full bg-white border border-[#D7CCC8] rounded px-3 py-2 text-[#3E2723] text-sm outline-none focus:border-[#8D6E63] focus:ring-1 focus:ring-[#8D6E63] transition-all font-medium"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmSaveArchive();
                  }
                }}
              />
              <p className="text-[10px] text-[#A1887F] mt-2 italic">
                Chương sẽ được lưu trữ cục bộ để tích lũy. Khi cần có thể tải ZIP toàn bộ hoặc khôi phục để sửa tiếp.
              </p>
            </div>
            
            <div className="bg-[#F5F2F0] px-5 py-3 border-t border-[#D7CCC8] flex justify-end gap-2">
              <button
                onClick={() => setShowSaveArchiveModal(false)}
                className="px-3.5 py-1.5 rounded text-xs font-bold text-[#5D4037] hover:bg-[#D7CCC8]/30 transition-all border border-transparent"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmSaveArchive}
                className="px-4 py-1.5 rounded bg-[#5D4037] hover:bg-[#3E2723] text-white text-xs font-bold transition-all shadow-sm"
              >
                Lưu Chương
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
