import React, { useState, useMemo, useEffect } from 'react';
import { Chapter, CustomTerm } from '../types';
import { X, Search, BookOpen, Trash2, RotateCcw, Calendar, CheckSquare, Square, FolderDown, Edit2, Check, AlertCircle, Clock, Archive } from 'lucide-react';
import { vietphraseEngine } from '../services/vietphraseService';
import JSZip from 'jszip';

interface ChapterArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: Chapter[];
  customTerms: CustomTerm[];
  onSelectChapter: (chapter: Chapter) => void;
  onMoveToTrash: (id: string) => void;
  onRestoreFromTrash: (id: string) => void;
  onPermanentDeleteChapter: (id: string) => void;
  onRenameChapter: (id: string, newName: string) => void;
  onClearAll: () => void;
  onEmptyTrash: () => void;
}

export const ChapterArchiveModal: React.FC<ChapterArchiveModalProps> = ({
  isOpen,
  onClose,
  chapters,
  customTerms,
  onSelectChapter,
  onMoveToTrash,
  onRestoreFromTrash,
  onPermanentDeleteChapter,
  onRenameChapter,
  onClearAll,
  onEmptyTrash
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'trash'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [showZipOptions, setShowZipOptions] = useState(false);
  const [optExportTable, setOptExportTable] = useState(true);
  const [optExportParallel, setOptExportParallel] = useState(false);
  const [optExportEdit, setOptExportEdit] = useState(false);

  // Tách biệt chương hoạt động và chương trong thùng rác
  const activeChapters = useMemo(() => {
    return (chapters || []).filter(c => !c.deletedAt);
  }, [chapters]);

  const trashChapters = useMemo(() => {
    return (chapters || []).filter(c => !!c.deletedAt);
  }, [chapters]);

  // Khởi tạo chọn tất cả theo tab hoạt động
  useEffect(() => {
    if (isOpen && activeTab === 'active') {
      setSelectedIds(new Set(activeChapters.map(c => c.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [isOpen, activeTab, activeChapters.length]);

  // Lọc theo tìm kiếm và tab hiện tại
  const filteredChapters = useMemo(() => {
    const list = activeTab === 'active' ? activeChapters : trashChapters;
    return list.filter(c => {
      const name = (c.name || '').toLowerCase();
      const source = (c.inputText || '').toLowerCase();
      const natural = (c.result?.naturalTranslation || '').toLowerCase();
      return name.includes(searchTerm.toLowerCase()) || 
             source.includes(searchTerm.toLowerCase()) || 
             natural.includes(searchTerm.toLowerCase());
    }).sort((a, b) => (b.deletedAt || b.timestamp) - (a.deletedAt || a.timestamp));
  }, [activeTab, activeChapters, trashChapters, searchTerm]);

  // Toggle chọn 1 chương
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Toggle chọn tất cả
  const toggleSelectAll = () => {
    const visibleIds = filteredChapters.map(c => c.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    
    const next = new Set(selectedIds);
    if (allSelected) {
      visibleIds.forEach(id => next.delete(id));
    } else {
      visibleIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  // Sửa tên
  const startEditing = (c: Chapter) => {
    setEditingId(c.id);
    setEditingName(c.name);
  };

  const saveNameEdit = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      onRenameChapter(id, trimmed);
    }
    setEditingId(null);
  };

  const handleExportZipClick = () => {
    const selectedChapters = activeChapters.filter(c => selectedIds.has(c.id));
    if (selectedChapters.length === 0) return;
    setShowZipOptions(true);
  };

  // Xuất file ZIP
  const performExportZip = async () => {
    const selectedChapters = activeChapters.filter(c => selectedIds.has(c.id));
    if (selectedChapters.length === 0) return;

    if (!optExportTable && !optExportParallel && !optExportEdit) {
      alert("Vui lòng chọn ít nhất một định dạng tải về!");
      return;
    }

    setIsExporting(true);
    setShowZipOptions(false);

    try {
      const zip = new JSZip();

      const customMap = new Map<string, string>();
      customTerms.forEach(t => {
        if (t.term && t.meaning) {
          customMap.set(t.term.trim(), t.meaning.trim());
        }
      });

      selectedChapters.forEach(chapter => {
        if (!chapter.result?.segments || chapter.result.segments.length === 0) return;

        let fileWithExt = chapter.name.trim();
        if (!fileWithExt.endsWith('.doc') && !fileWithExt.endsWith('.docx')) {
          fileWithExt += '.doc';
        }

        // 1. Dạng bảng
        if (optExportTable) {
          let tableRowsHtml = "";
          chapter.result.segments.forEach(seg => {
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
              <title>${chapter.name}</title>
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
                    <th style="width: 23%; background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8;">DeepL</th>
                    <th style="width: 32%; background-color: #EFEBE9; color: #3E2723; border: 1px solid #D7CCC8;">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHtml}
                </tbody>
              </table>
            </body>
            </html>
          `;

          const content = '\ufeff' + htmlContent;
          zip.file(`Bản đối chiếu dạng bảng/${fileWithExt}`, content);
        }

        // 2. Song ngữ
        if (optExportParallel) {
          const parallelHtmlContent = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
              <meta charset="utf-8">
              <title>${chapter.name}</title>
              <style>
                body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.6; color: #333333; }
                p.raw { color: #8D6E63; font-family: "SimSun", serif; font-size: 11pt; margin: 0 0 4px 0; }
                p.edit { color: #3E2723; font-weight: bold; margin: 0 0 16px 0; }
              </style>
            </head>
            <body>
              ${chapter.result.segments.map(seg => {
                const raw = (seg.source || '').trim();
                const edit = (seg.natural || '').trim();
                if (!raw && !edit) return '';
                return `<p class="raw">${raw}</p><p class="edit">${edit}</p>`;
              }).join('')}
            </body>
            </html>
          `;
          zip.file(`Song ngữ (Edit & Raw)/${fileWithExt}`, '\ufeff' + parallelHtmlContent);
        }

        // 3. Chỉ Edit
        if (optExportEdit) {
          const editHtmlContent = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
              <meta charset="utf-8">
              <title>${chapter.name}</title>
              <style>
                body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.6; color: #3E2723; }
                p { margin: 0 0 12px 0; }
              </style>
            </head>
            <body>
              ${chapter.result.segments.map(seg => {
                const edit = (seg.natural || '').trim();
                if (!edit) return '';
                return `<p>${edit}</p>`;
              }).join('')}
            </body>
            </html>
          `;
          zip.file(`Bản tinh chỉnh (Chỉ Edit)/${fileWithExt}`, '\ufeff' + editHtmlContent);
        }
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bo_chuong_dich_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Lỗi xuất file ZIP", e);
      alert("Đã xảy ra lỗi khi tạo file ZIP. Vui lòng thử lại!");
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const visibleIds = filteredChapters.map(c => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#3E2723]/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FFFDF7] rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] border border-[#D7CCC8]">
        
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-[#D7CCC8] flex justify-between items-center bg-[#EFE5D9]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[#3E2723]">
              <Archive size={20} className="text-[#5D4037]" />
              <h2 className="text-base font-bold">Quản Lý Kho Chương</h2>
            </div>

            {/* Tab chuyển đổi giữa Kho chương và Thùng rác */}
            <div className="flex bg-[#D7CCC8]/60 p-0.5 rounded-lg border border-[#BCAAA4]/40">
              <button
                onClick={() => { setActiveTab('active'); setSearchTerm(''); }}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'active' 
                    ? 'bg-[#5D4037] text-white shadow-xs' 
                    : 'text-[#5D4037] hover:bg-[#D7CCC8]/60'
                }`}
              >
                <BookOpen size={13} />
                <span>Kho lưu trữ ({activeChapters.length})</span>
              </button>
              <button
                onClick={() => { setActiveTab('trash'); setSearchTerm(''); }}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'trash' 
                    ? 'bg-amber-900 text-white shadow-xs' 
                    : 'text-[#5D4037] hover:bg-[#D7CCC8]/60'
                }`}
              >
                <Trash2 size={13} />
                <span>Thùng rác ({trashChapters.length})</span>
              </button>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="text-[#A1887F] hover:text-[#3E2723] hover:bg-[#D7CCC8] p-1.5 rounded-full transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3.5 border-b border-[#D7CCC8] bg-white flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1887F]" />
            <input 
              type="text" 
              placeholder={activeTab === 'active' ? "Tìm trong kho lưu trữ..." : "Tìm trong thùng rác..."} 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs bg-[#EFE5D9]/50 border border-[#D7CCC8] rounded focus:ring-1 focus:ring-[#8D6E63] outline-none transition-all text-[#3E2723] placeholder:text-[#BCAAA4]"
            />
          </div>

          {activeTab === 'active' ? (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 text-xs font-bold text-[#5D4037] hover:text-[#3E2723] bg-[#EFEBE9]/40 border border-[#D7CCC8] px-3 py-1.5 rounded transition-all cursor-pointer"
              >
                {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                <span>Chọn tất cả ({selectedIds.size}/{activeChapters.length})</span>
              </button>
              
              <button
                onClick={handleExportZipClick}
                disabled={selectedIds.size === 0 || isExporting}
                className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded transition-all shadow-sm ${
                  selectedIds.size > 0 && !isExporting
                    ? 'bg-[#5D4037] text-white hover:bg-[#3E2723] cursor-pointer'
                    : 'bg-[#EFEBE9] text-[#BCAAA4] border border-[#D7CCC8] cursor-not-allowed'
                }`}
              >
                <FolderDown size={14} />
                <span>{isExporting ? 'Đang tạo ZIP...' : `Tải ZIP (${selectedIds.size} file)`}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <span className="text-[11px] text-[#8D6E63] italic">
                Tự động xóa vĩnh viễn sau 30 ngày
              </span>
            </div>
          )}
        </div>

        {/* Info Tip */}
        {activeTab === 'active' ? (
          <div className="bg-[#FFF8E1] px-6 py-2 border-b border-[#FFE082] flex items-center gap-2 text-xs text-[#795548]">
            <AlertCircle size={14} className="text-[#FFB300] shrink-0" />
            <span>Lưu trữ vĩnh viễn trên máy và Cloud. Khi xóa, chương sẽ được chuyển vào <strong>Thùng rác</strong> trong 30 ngày để bạn có thể khôi phục bất cứ lúc nào.</span>
          </div>
        ) : (
          <div className="bg-amber-50 px-6 py-2 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-900">
            <Clock size={14} className="text-amber-700 shrink-0" />
            <span>Các chương trong thùng rác sẽ được lưu giữ tối đa <strong>30 ngày</strong>. Bạn có thể bấm "Khôi phục" để đưa chương trở lại kho lưu trữ.</span>
          </div>
        )}

        {/* Chapter List */}
        <div className="flex-1 overflow-y-auto p-4 bg-[#F5E6D3]/50 space-y-2">
          {filteredChapters.length === 0 ? (
            <div className="text-center py-16 text-[#BCAAA4] italic text-xs">
              {activeTab === 'active' 
                ? (searchTerm ? 'Không tìm thấy chương nào phù hợp.' : 'Kho chương trống. Hãy lưu chương từ phần kết quả dịch!')
                : (searchTerm ? 'Không có chương phù hợp trong thùng rác.' : 'Thùng rác đang trống.')
              }
            </div>
          ) : (
            filteredChapters.map(c => {
              const isSelected = selectedIds.has(c.id);
              const isEditing = editingId === c.id;

              // Tính số ngày còn lại trong thùng rác
              const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
              const elapsed = Date.now() - (c.deletedAt || Date.now());
              const daysLeft = Math.max(0, Math.ceil((THIRTY_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));

              return (
                <div 
                  key={c.id} 
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    activeTab === 'trash'
                      ? 'bg-amber-50/60 border-amber-200 hover:border-amber-400'
                      : isSelected 
                        ? 'bg-white border-[#8D6E63] shadow-md ring-1 ring-[#8D6E63]/20' 
                        : 'bg-white border-[#D7CCC8] hover:border-[#8D6E63]/60 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                    {/* Checkbox (Chỉ hiện trong tab Kho lưu trữ) */}
                    {activeTab === 'active' && (
                      <button 
                        onClick={() => toggleSelect(c.id)}
                        className="text-[#5D4037] hover:scale-105 transition-transform shrink-0 cursor-pointer"
                      >
                        {isSelected ? <CheckSquare size={18} /> : <Square size={18} className="text-[#BCAAA4]" />}
                      </button>
                    )}

                    {/* Content info */}
                    <div className="flex-1 min-w-0">
                      {isEditing && activeTab === 'active' ? (
                        <div className="flex items-center gap-1.5">
                          <input 
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveNameEdit(c.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="bg-white border border-[#8D6E63] rounded px-2 py-0.5 text-xs text-[#3E2723] font-bold outline-none flex-1 max-w-sm focus:ring-1 focus:ring-[#8D6E63]"
                            autoFocus
                          />
                          <button 
                            onClick={() => saveNameEdit(c.id)}
                            className="bg-[#5D4037] text-white p-1 rounded hover:bg-[#3E2723] transition-colors cursor-pointer"
                          >
                            <Check size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-xs truncate ${activeTab === 'trash' ? 'text-[#5D4037]' : 'text-[#3E2723]'}`}>
                            {c.name}
                          </span>
                          {activeTab === 'active' && (
                            <button 
                              onClick={() => startEditing(c)}
                              className="text-[#A1887F] hover:text-[#3E2723] transition-colors p-0.5 cursor-pointer"
                              title="Sửa tên chương"
                            >
                              <Edit2 size={11} />
                            </button>
                          )}
                          {activeTab === 'trash' && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full border ${
                              daysLeft <= 3 
                                ? 'bg-red-100 text-red-800 border-red-300 animate-pulse' 
                                : 'bg-amber-100 text-amber-900 border-amber-300'
                            }`}>
                              Còn {daysLeft} ngày
                            </span>
                          )}
                        </div>
                      )}
                      
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-[#A1887F]">
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {activeTab === 'trash' && c.deletedAt ? (
                            <span>Đã xóa: {new Date(c.deletedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
                          ) : (
                            <span>Lưu lúc: {new Date(c.timestamp).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
                          )}
                        </span>
                        <span>•</span>
                        <span>{c.result?.segments?.length || 0} đoạn edit</span>
                        {c.completedSegments && c.completedSegments.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                              Đã làm {c.completedSegments.length}/{c.result?.segments?.length || 0}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {activeTab === 'active' ? (
                      <>
                        <button
                          onClick={() => {
                            if (window.confirm(`Bạn có chắc chắn muốn nạp và tiếp tục sửa "${c.name}"? Bản nháp hiện tại của bạn sẽ được thay thế bằng chương này.`)) {
                              onSelectChapter(c);
                            }
                          }}
                          className="flex items-center gap-1 text-[10px] font-bold text-[#5D4037] hover:text-[#3E2723] bg-[#EFEBE9] hover:bg-[#D7CCC8] px-2.5 py-1 rounded transition-colors cursor-pointer"
                          title="Nạp vào editor để edit tiếp"
                        >
                          <RotateCcw size={11} />
                          <span>Sửa tiếp</span>
                        </button>
                        
                        <button
                          onClick={() => {
                            if (window.confirm(`Chuyển chương "${c.name}" vào thùng rác? (Bạn có thể khôi phục lại bất cứ lúc nào trong vòng 30 ngày)`)) {
                              onMoveToTrash(c.id);
                            }
                          }}
                          className="text-[#A1887F] hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors cursor-pointer"
                          title="Chuyển vào thùng rác"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => onRestoreFromTrash(c.id)}
                          className="flex items-center gap-1 text-[10px] font-bold text-emerald-800 hover:text-emerald-950 bg-emerald-100/70 hover:bg-emerald-200 px-2.5 py-1 rounded border border-emerald-300 transition-colors cursor-pointer"
                          title="Khôi phục lại vào Kho lưu trữ"
                        >
                          <RotateCcw size={11} />
                          <span>Khôi phục</span>
                        </button>

                        <button
                          onClick={() => {
                            if (window.confirm(`CẢNH BÁO: Xóa vĩnh viễn chương "${c.name}"? Hành động này sẽ không thể khôi phục lại được nữa!`)) {
                              onPermanentDeleteChapter(c.id);
                            }
                          }}
                          className="flex items-center gap-1 text-[10px] font-bold text-red-700 hover:text-red-900 bg-red-100/70 hover:bg-red-200 px-2 py-1 rounded border border-red-200 transition-colors cursor-pointer"
                          title="Xóa vĩnh viễn ngay lập tức"
                        >
                          <Trash2 size={11} />
                          <span>Xóa vĩnh viễn</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-[#D7CCC8] bg-white flex justify-between items-center">
          {activeTab === 'active' ? (
            <>
              <span className="text-xs text-[#A1887F] font-bold">Tổng cộng: {activeChapters.length} chương lưu trữ</span>
              {activeChapters.length > 0 && (
                <button 
                  onClick={() => {
                    if (window.confirm("Chuyển TOÀN BỘ chương trong kho vào Thùng rác? (Bạn vẫn có 30 ngày để khôi phục)")) {
                      onClearAll();
                    }
                  }}
                  className="text-amber-800 text-[10px] font-bold hover:bg-amber-50 px-2.5 py-1 rounded transition-colors flex items-center gap-1 border border-amber-300 cursor-pointer"
                >
                  <Trash2 size={12} /> Chuyển tất cả vào thùng rác
                </button>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-[#8D6E63] font-bold">Thùng rác: {trashChapters.length} chương</span>
              {trashChapters.length > 0 && (
                <button 
                  onClick={() => {
                    if (window.confirm("CẢNH BÁO NGUY HIỂM: Bạn có chắc chắn muốn DỌN SẠCH THÙNG RÁC? Toàn bộ chương trong thùng rác sẽ bị XÓA VĨNH VIỄN không thể khôi phục!")) {
                      onEmptyTrash();
                    }
                  }}
                  className="text-red-600 hover:text-white hover:bg-red-600 text-[10px] font-bold bg-red-50 px-2.5 py-1 rounded transition-colors flex items-center gap-1 border border-red-300 cursor-pointer"
                >
                  <Trash2 size={12} /> Dọn sạch thùng rác
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showZipOptions && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#3E2723]/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#FFFDF7] rounded-xl border border-[#D7CCC8] shadow-2xl w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-[#D7CCC8] bg-[#EFE5D9] flex justify-between items-center">
              <div className="flex items-center gap-2 text-[#3E2723] font-bold text-sm">
                <FolderDown size={16} className="text-[#5D4037]" />
                <span>Cấu hình tải bộ chương ZIP</span>
              </div>
              <button onClick={() => setShowZipOptions(false)} className="text-[#A1887F] hover:text-[#3E2723] p-1 rounded-full transition-colors cursor-pointer">
                <X size={16} />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <p className="text-xs text-[#5D4037] font-medium leading-relaxed">
                Hệ thống sẽ nén <strong>{selectedIds.size} chương đã chọn</strong> thành một file ZIP duy nhất. Bạn muốn lấy các định dạng tài liệu Word nào?
              </p>

              <div className="space-y-2.5 bg-white p-3.5 rounded-lg border border-[#D7CCC8]">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-[#3E2723]">
                  <input 
                    type="checkbox" 
                    checked={optExportTable}
                    onChange={(e) => setOptExportTable(e.target.checked)}
                    className="w-4 h-4 rounded text-[#5D4037] focus:ring-[#8D6E63] cursor-pointer" 
                  />
                  <span>1. Bản đối chiếu 4 cột (Raw - Vietphrase - DeepL - Edit)</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-[#3E2723]">
                  <input 
                    type="checkbox" 
                    checked={optExportParallel}
                    onChange={(e) => setOptExportParallel(e.target.checked)}
                    className="w-4 h-4 rounded text-[#5D4037] focus:ring-[#8D6E63] cursor-pointer" 
                  />
                  <span>2. Bản song ngữ song hành (Edit & Raw)</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-[#3E2723]">
                  <input 
                    type="checkbox" 
                    checked={optExportEdit}
                    onChange={(e) => setOptExportEdit(e.target.checked)}
                    className="w-4 h-4 rounded text-[#5D4037] focus:ring-[#8D6E63] cursor-pointer" 
                  />
                  <span>3. Bản tinh chỉnh hoàn thiện (Chỉ Edit sạch)</span>
                </label>
              </div>
            </div>

            <div className="bg-[#F5F2F0] px-5 py-3 border-t border-[#D7CCC8] flex justify-end gap-2">
              <button
                onClick={() => setShowZipOptions(false)}
                className="px-3.5 py-1.5 rounded text-xs font-bold text-[#5D4037] hover:bg-[#D7CCC8]/30 transition-all border border-transparent cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={performExportZip}
                disabled={!optExportTable && !optExportParallel && !optExportEdit}
                className="px-4 py-1.5 rounded bg-[#5D4037] hover:bg-[#3E2723] text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <FolderDown size={14} />
                <span>Bắt đầu tải ZIP</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
