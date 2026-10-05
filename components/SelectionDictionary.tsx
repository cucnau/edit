
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Sparkles, X } from 'lucide-react';
import { quickLookup } from '../services/geminiService';
import { CustomTerm } from '../types';

interface SelectionDictionaryProps {
  customTerms: CustomTerm[];
}

export const SelectionDictionary: React.FC<SelectionDictionaryProps> = ({ customTerms }) => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [result, setResult] = useState<{ pinyin: string; hanViet: string; meaning: string } | null>(null);
  const [loading, setLoading] = useState(false);
  
  const popupRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<string | null>(null); 
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      let text = '';
      let rect: DOMRect | null = null;
      let isInputArea = false;

      const target = e.target as HTMLElement;
      
      if (popupRef.current && popupRef.current.contains(target)) return;

      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
          const input = target as HTMLTextAreaElement | HTMLInputElement;
          const start = input.selectionStart;
          const end = input.selectionEnd;
          if (start !== null && end !== null && start !== end) {
              const inputText = input.value.substring(start, end).trim();
              if (inputText) {
                  text = inputText;
                  isInputArea = true;
              }
          }
      } else {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) {
              text = selection.toString().trim();
              if (text) {
                 try {
                    const range = selection.getRangeAt(0);
                    const clientRects = range.getClientRects();
                    if (clientRects.length > 0) {
                         rect = range.getBoundingClientRect();
                    }
                 } catch (e) { }
              }
          }
      }

      if (!text || text.length > 50) { 
         if (!popupRef.current?.contains(target)) {
            setPosition(null);
         }
         return; 
      }

      let x = 0;
      let y = 0;

      if (rect && !isInputArea) {
          x = rect.left + rect.width / 2;
          y = rect.top + window.scrollY - 10;
      } else {
          x = e.clientX;
          y = e.clientY + window.scrollY - 20; 
      }

      if (x < 140) x = 140;
      if (x > window.innerWidth - 140) x = window.innerWidth - 140;

      setPosition({ x, y });
      setSelectedText(text);
      setResult(null);
      setLoading(true);

      debounceTimerRef.current = setTimeout(async () => {
          const found = customTerms.find(t => t.term.toLowerCase() === text.toLowerCase());
          if (found) {
              setResult({
                  pinyin: 'User Dict',
                  hanViet: 'Tự định nghĩa',
                  meaning: found.meaning
              });
              setLoading(false);
              return;
          }

          const currentRequestId = Date.now().toString();
          requestRef.current = currentRequestId;
          
          try {
              const data = await quickLookup(text);
              if (requestRef.current === currentRequestId) {
                  setResult(data);
                  setLoading(false);
              }
          } catch (err) {
              if (requestRef.current === currentRequestId) {
                setResult({ pinyin: '...', hanViet: '...', meaning: 'Lỗi kết nối' });
                setLoading(false);
              }
          }
      }, 600); 
    };

    const handleMouseDown = (e: MouseEvent) => {
        if (popupRef.current && popupRef.current.contains(e.target as Node)) {
            return;
        }
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        setPosition(null);
        setResult(null);
        setLoading(false);
        requestRef.current = null;
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [customTerms]);

  if (!position) return null;

  return createPortal(
    <div
      ref={popupRef}
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%) translateY(-10px)',
      }}
      className="absolute z-[9999] pointer-events-auto animate-in fade-in zoom-in-95 duration-200"
    >
      <div className="bg-[#3E2723] text-[#F5E6D3] rounded-lg shadow-xl border border-[#5D4037] p-3 min-w-[200px] max-w-[280px] relative">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 bg-[#3E2723] border-r border-b border-[#5D4037] rotate-45"></div>

        <div className="flex justify-between items-start mb-1">
            <span className="font-serif-sc font-bold text-lg text-white leading-none">
                {selectedText}
            </span>
            <button 
                onClick={() => setPosition(null)}
                className="text-[#A1887F] hover:text-white -mr-1 -mt-1"
            >
                <X size={14} />
            </button>
        </div>
        
        {loading ? (
           <div className="flex items-center gap-2 text-xs text-[#D7CCC8] py-1">
              <Loader2 size={12} className="animate-spin" />
              <span>Đang tra cứu...</span>
           </div>
        ) : result ? (
           <div className="space-y-1">
              <div className="flex items-center gap-2 text-[10px] text-[#D7CCC8]">
                 <span className="bg-[#5D4037] px-1 rounded text-[#FFECB3]">{result.pinyin}</span>
                 <span className="italic opacity-80">{result.hanViet}</span>
              </div>
              <div className="text-sm font-bold text-[#FFECB3] pt-1 border-t border-[#5D4037] mt-1">
                 {result.meaning}
              </div>
           </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};
