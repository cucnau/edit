
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TranslationResponse, VocabItem, CustomTerm, Character } from '../types';
import { Copy, TableProperties, Check, Info, X, Users, ClipboardList, CheckCircle2 } from 'lucide-react';

interface TranslationOutputProps {
  data: TranslationResponse;
  customTerms?: CustomTerm[];
  characters?: Character[];
  completedSegments?: number[];
  onUpdateSegment?: (index: number, newNatural: string) => void;
  onToggleComplete?: (index: number) => void;
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
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    
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
    }, [text]);

    return (
        <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onUpdate(e.target.value)}
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
    onToggleComplete
}) => {
  const [activeVocab, setActiveVocab] = useState<{ 
    item: VocabItem; 
    position: { x: number; y: number }; 
    side: 'top' | 'bottom';
    type?: 'char' | 'custom' | 'ai' 
  } | null>(null);
  const [copiedMode, setCopiedMode] = useState<'all' | 'parallel' | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = (text: string, mode: 'all' | 'parallel') => {
    navigator.clipboard.writeText(text.trim());
    setCopiedMode(mode);
    setTimeout(() => setCopiedMode(null), 2000);
  };

  const hasSegments = data.segments && data.segments.length > 0;
  
  // SỬA ĐỔI: Dùng .join('\n') để dính sát nhau
  const getParallelText = () => data.segments.map(seg => `${(seg.source || '').trim()}\n${(seg.natural || '').trim()}`).join('\n');
  const getNaturalText = () => data.segments.map(seg => (seg.natural || '').trim()).join('\n');

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
             <div className="flex items-center gap-1.5 text-[#3E2723] font-bold text-[10px] uppercase tracking-tight"><TableProperties size={12} /><span>Dịch thuật & Đối chiếu</span></div>
             <div className="flex items-center gap-1.5">
                <button onClick={() => copyToClipboard(getParallelText(), 'parallel')} className="flex items-center gap-1 text-[9px] font-bold text-[#5D4037] hover:text-[#3E2723] bg-white border border-[#D7CCC8] px-2 py-0.5 rounded hover:bg-[#D7CCC8] transition-colors shadow-sm">{copiedMode === 'parallel' ? <Check size={10} /> : <ClipboardList size={10} />}<span>Song Song</span></button>
                <button onClick={() => copyToClipboard(getNaturalText(), 'all')} className="flex items-center gap-1 text-[9px] font-bold text-[#8D6E63] hover:text-[#3E2723] bg-white border border-[#D7CCC8] px-2 py-0.5 rounded hover:bg-[#D7CCC8] transition-colors shadow-sm">{copiedMode === 'all' ? <Check size={10} /> : <Copy size={10} />}<span>Dịch Mượt</span></button>
             </div>
          </div>
          {hasSegments && (
             <div className="flex w-full bg-[#EFEBE9] text-[#5D4037] text-[9px] font-bold uppercase tracking-wider shadow-sm border-t border-[#D7CCC8]">
                 <div className="w-[45%] p-1 border-r border-[#D7CCC8] pl-2">Nguồn</div>
                 <div className="w-[55%] p-1 pl-2">Bản dịch</div>
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
                      const cleanQuick = (seg.quick || '').trim();

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
                                    <div className="text-[8.5px] text-[#A1887F] leading-[1.1] italic opacity-60 -mt-0.5 break-words"><span className="font-bold mr-1 opacity-80 not-italic text-[#5D4037]">DeepL:</span>{cleanDeepl}</div>
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
    </div>
  );
};
