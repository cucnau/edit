import React, { useState, useMemo } from 'react';
import { Novel, Chapter, CustomTerm } from '../types';
import { AuthPanel } from './AuthPanel';
import { vietphraseEngine } from '../services/vietphraseService';
import JSZip from 'jszip';
import {
  BookOpen,
  FileText,
  FolderOpen,
  FolderPlus,
  Plus,
  Search,
  LayoutGrid,
  List,
  Trash2,
  RotateCcw,
  MoreVertical,
  Pencil,
  Check,
  X,
  FileDown,
  FolderDown,
  Loader2,
  ArrowLeft,
  ChevronRight
} from 'lucide-react';

interface HomeScreenProps {
  novels: Novel[];
  chapters: Chapter[];
  customTerms: CustomTerm[];
  selectedNovelFilter: string; // '' = Tất cả truyện
  onSelectNovelFilter: (novelId: string) => void;
  onCreateNovel: (name: string) => Promise<Novel | null>;
  onRenameNovel: (id: string, newName: string) => Promise<void>;
  onOpenChapter: (chapter: Chapter) => void;
  onCreateNewChapter: (chapterName: string, novelId?: string) => Promise<void>;
  onRenameChapter: (id: string, newName: string) => Promise<void>;
  onMoveToTrash: (id: string) => Promise<void>;
  onRestoreFromTrash: (id: string) => Promise<void>;
  onPermanentDeleteChapter: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  isLoadingData?: boolean;
  isSignedIn: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  novels,
  chapters,
  customTerms,
  selectedNovelFilter,
  onSelectNovelFilter,
  onCreateNovel,
  onRenameNovel,
  onOpenChapter,
  onCreateNewChapter,
  onRenameChapter,
  onMoveToTrash,
  onRestoreFromTrash,
  onPermanentDeleteChapter,
  onEmptyTrash,
  isLoadingData = false,
  isSignedIn
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'trash'>('active');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'recent' | 'name'>('recent');

  // Create Novel dialog state
  const [showCreateNovel, setShowCreateNovel] = useState(false);
  const [newNovelName, setNewNovelName] = useState('');
  const [isCreatingNovel, setIsCreatingNovel] = useState(false);
  const [novelError, setNovelError] = useState<string | null>(null);

  // Create Chapter dialog state
  const [showCreateChapter, setShowCreateChapter] = useState(false);
  const [createChapterNovelId, setCreateChapterNovelId] = useState<string | undefined>(undefined);
  const [newChapterName, setNewChapterName] = useState('');
  const [isCreatingChapter, setIsCreatingChapter] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);

  // Rename Novel state
  const [editingNovelId, setEditingNovelId] = useState<string | null>(null);
  const [editingNovelName, setEditingNovelName] = useState('');

  // Rename Chapter state
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingChapterName, setEditingChapterName] = useState('');

  // Card dropdown menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Confirm Empty Trash / Permanent Delete
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);

  // Batch ZIP export
  const [showZipModal, setShowZipModal] = useState(false);
  const [zipSelectedIds, setZipSelectedIds] = useState<Set<string>>(new Set());
  const [optExportTable, setOptExportTable] = useState(true);
  const [optExportParallel, setOptExportParallel] = useState(false);
  const [optExportEdit, setOptExportEdit] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);

  const novelMap = useMemo(() => {
    const map = new Map<string, string>();
    novels.forEach(n => map.set(n.id, n.name));
    return map;
  }, [novels]);

  const activeChaptersAll = useMemo(() => {
    return (chapters || []).filter(c => !c.deletedAt);
  }, [chapters]);

  const trashChaptersAll = useMemo(() => {
    return (chapters || []).filter(c => !!c.deletedAt);
  }, [chapters]);

  // Count active & trash chapters and latest timestamp per novel
  const novelStats = useMemo(() => {
    const activeCounts = new Map<string, number>();
    const trashCounts = new Map<string, number>();
    const latestTs = new Map<string, number>();
    (chapters || []).forEach(c => {
      const nid = c.novelId || '__uncategorized__';
      const ts = c.deletedAt || c.timestamp || 0;
      if (ts > (latestTs.get(nid) || 0)) latestTs.set(nid, ts);
      if (c.deletedAt) {
        trashCounts.set(nid, (trashCounts.get(nid) || 0) + 1);
      } else {
        activeCounts.set(nid, (activeCounts.get(nid) || 0) + 1);
      }
    });
    return { activeCounts, trashCounts, latestTs };
  }, [chapters]);

  const uncategorizedCount = (novelStats.activeCounts.get('__uncategorized__') || 0) + (novelStats.trashCounts.get('__uncategorized__') || 0);

  const filteredNovels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = novels.filter(n => !q || (n.name || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '', 'vi', { numeric: true });
      }
      const tsA = novelStats.latestTs.get(a.id) || 0;
      const tsB = novelStats.latestTs.get(b.id) || 0;
      return tsB - tsA;
    });
  }, [novels, searchQuery, sortBy, novelStats]);

  const currentNovelActiveCount = useMemo(() => {
    if (!selectedNovelFilter) return 0;
    return activeChaptersAll.filter(c =>
      selectedNovelFilter === '__uncategorized__' ? !c.novelId : c.novelId === selectedNovelFilter
    ).length;
  }, [activeChaptersAll, selectedNovelFilter]);

  const currentNovelTrashCount = useMemo(() => {
    if (!selectedNovelFilter) return 0;
    return trashChaptersAll.filter(c =>
      selectedNovelFilter === '__uncategorized__' ? !c.novelId : c.novelId === selectedNovelFilter
    ).length;
  }, [trashChaptersAll, selectedNovelFilter]);

  const filteredChapters = useMemo(() => {
    if (!selectedNovelFilter) return [];
    const base = activeTab === 'active' ? activeChaptersAll : trashChaptersAll;
    const q = searchQuery.trim().toLowerCase();

    const list = base.filter(c => {
      if (selectedNovelFilter === '__uncategorized__') {
        if (c.novelId) return false;
      } else if (c.novelId !== selectedNovelFilter) {
        return false;
      }
      if (!q) return true;
      const chapName = (c.name || '').toLowerCase();
      const raw = (c.inputText || '').toLowerCase();
      const edited = (c.result?.naturalTranslation || '').toLowerCase();
      return chapName.includes(q) || raw.includes(q) || edited.includes(q);
    });

    return list.sort((a, b) => {
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '', 'vi', { numeric: true });
      }
      const timeA = activeTab === 'trash' ? (a.deletedAt || a.timestamp || 0) : (a.timestamp || 0);
      const timeB = activeTab === 'trash' ? (b.deletedAt || b.timestamp || 0) : (b.timestamp || 0);
      return timeB - timeA;
    });
  }, [activeTab, activeChaptersAll, trashChaptersAll, selectedNovelFilter, searchQuery, sortBy]);

  const formatTimestamp = (ts?: number) => {
    if (!ts) return 'Chưa rõ';
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  };

  const getDaysRemaining = (deletedAt?: number) => {
    if (!deletedAt) return 30;
    const diffMs = Date.now() - deletedAt;
    const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, 30 - daysPassed);
  };

  const getChapterPreview = (chapter: Chapter) => {
    const segments = chapter.result?.segments || [];
    const lines = segments
      .slice(0, 4)
      .map(s => (s.natural || s.source || '').trim())
      .filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
    return (chapter.inputText || '').trim().split('\n').slice(0, 3).join('\n') || '(Chưa có nội dung)';
  };

  const handleSubmitCreateNovel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newNovelName.trim();
    if (!trimmed) return;
    setIsCreatingNovel(true);
    setNovelError(null);
    try {
      const created = await onCreateNovel(trimmed);
      if (created) {
        onSelectNovelFilter(created.id);
        setShowCreateNovel(false);
        setNewNovelName('');
      }
    } catch (err: any) {
      setNovelError(err?.message || 'Không thể tạo truyện mới.');
    } finally {
      setIsCreatingNovel(false);
    }
  };

  const openCreateChapterModal = (novelId?: string) => {
    setCreateChapterNovelId(novelId);
    setNewChapterName('');
    setChapterError(null);
    setShowCreateChapter(true);
  };

  const handleSubmitCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newChapterName.trim();
    if (!trimmed) return;

    const duplicate = activeChaptersAll.find(c => {
      const sameNovel = createChapterNovelId
        ? c.novelId === createChapterNovelId
        : !c.novelId;
      return sameNovel && c.name.trim().toLowerCase() === trimmed.toLowerCase();
    });

    if (duplicate) {
      setChapterError(`Chương "${trimmed}" đã tồn tại trong bộ truyện này. Vui lòng đặt tên khác.`);
      return;
    }

    setIsCreatingChapter(true);
    setChapterError(null);
    try {
      await onCreateNewChapter(trimmed, createChapterNovelId);
      setShowCreateChapter(false);
      setNewChapterName('');
    } catch (err: any) {
      setChapterError(err?.message || 'Không thể tạo chương mới.');
    } finally {
      setIsCreatingChapter(false);
    }
  };

  const handleSaveChapterRename = async (id: string) => {
    const trimmed = editingChapterName.trim();
    setEditingChapterId(null);
    if (trimmed) {
      await onRenameChapter(id, trimmed);
    }
  };

  const handleSaveNovelRename = async (id: string) => {
    const trimmed = editingNovelName.trim();
    setEditingNovelId(null);
    if (trimmed) {
      await onRenameNovel(id, trimmed);
    }
  };

  const exportSingleChapterWord = (chapter: Chapter) => {
    if (!chapter.result?.segments || chapter.result.segments.length === 0) return;
    const htmlContent = `
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
          return edit ? `<p>${edit}</p>` : '';
        }).join('')}
      </body>
      </html>
    `;
    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    let fileName = chapter.name.trim();
    if (!fileName.endsWith('.doc') && !fileName.endsWith('.docx')) fileName += '.doc';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openZipExportModal = () => {
    const visibleActive = filteredChapters.filter(c => !c.deletedAt);
    setZipSelectedIds(new Set(visibleActive.map(c => c.id)));
    setShowZipModal(true);
  };

  const performExportZip = async () => {
    const selectedChapters = activeChaptersAll.filter(c => zipSelectedIds.has(c.id));
    if (selectedChapters.length === 0) return;
    if (!optExportTable && !optExportParallel && !optExportEdit) return;

    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      const customMap = new Map<string, string>();
      customTerms.forEach(t => {
        if (t.term && t.meaning) customMap.set(t.term.trim(), t.meaning.trim());
      });

      selectedChapters.forEach(chapter => {
        if (!chapter.result?.segments || chapter.result.segments.length === 0) return;
        let fileWithExt = chapter.name.trim();
        if (!fileWithExt.endsWith('.doc') && !fileWithExt.endsWith('.docx')) {
          fileWithExt += '.doc';
        }

        if (optExportTable) {
          let tableRowsHtml = '';
          chapter.result.segments.forEach(seg => {
            const cleanSource = (seg.source || '').trim();
            const cleanNatural = (seg.natural || '').trim();
            const cleanDeepl = (seg.deepl || '').trim();
            const cleanQuick = (vietphraseEngine.translate(cleanSource, customMap) || seg.quick || '').trim();
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
            <head><meta charset="utf-8"><title>${chapter.name}</title></head>
            <body>
              <table style="border-collapse: collapse; width: 100%;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #D7CCC8; padding: 8px; background-color: #EFEBE9;">Raw</th>
                    <th style="border: 1px solid #D7CCC8; padding: 8px; background-color: #EFEBE9;">Vietphrase</th>
                    <th style="border: 1px solid #D7CCC8; padding: 8px; background-color: #EFEBE9;">DeepL</th>
                    <th style="border: 1px solid #D7CCC8; padding: 8px; background-color: #EFEBE9;">Edit</th>
                  </tr>
                </thead>
                <tbody>${tableRowsHtml}</tbody>
              </table>
            </body>
            </html>
          `;
          zip.file(`Bản đối chiếu dạng bảng/${fileWithExt}`, '\ufeff' + htmlContent);
        }

        if (optExportParallel) {
          const parallelHtml = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset="utf-8"><title>${chapter.name}</title></head>
            <body style="font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6;">
              ${chapter.result.segments.map(seg => {
                const raw = (seg.source || '').trim();
                const edit = (seg.natural || '').trim();
                if (!raw && !edit) return '';
                return `<p style="color:#8D6E63;margin:0 0 4px 0;">${raw}</p><p style="color:#3E2723;font-weight:bold;margin:0 0 14px 0;">${edit}</p>`;
              }).join('')}
            </body>
            </html>
          `;
          zip.file(`Song ngữ (Edit & Raw)/${fileWithExt}`, '\ufeff' + parallelHtml);
        }

        if (optExportEdit) {
          const editHtml = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset="utf-8"><title>${chapter.name}</title></head>
            <body style="font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #3E2723;">
              ${chapter.result.segments.map(seg => {
                const edit = (seg.natural || '').trim();
                return edit ? `<p style="margin:0 0 12px 0;">${edit}</p>` : '';
              }).join('')}
            </body>
            </html>
          `;
          zip.file(`Bản Edit/${fileWithExt}`, '\ufeff' + editHtml);
        }
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const novelLabel = selectedNovelFilter
        ? (selectedNovelFilter === '__uncategorized__' ? 'Chua_phan_loai' : (novelMap.get(selectedNovelFilter) || 'Truyen'))
        : 'Tat_ca_chuong';
      a.href = url;
      a.download = `${novelLabel}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowZipModal(false);
    } finally {
      setIsExportingZip(false);
    }
  };

  const openNovelFolder = (novelId: string) => {
    setSearchQuery('');
    setActiveTab('active');
    setConfirmEmptyTrash(false);
    setOpenMenuId(null);
    onSelectNovelFilter(novelId);
  };

  const backToNovelList = () => {
    setSearchQuery('');
    setActiveTab('active');
    setConfirmEmptyTrash(false);
    setOpenMenuId(null);
    onSelectNovelFilter('');
  };

  const selectedNovelName = selectedNovelFilter === '__uncategorized__'
    ? 'Chưa phân loại'
    : (novelMap.get(selectedNovelFilter) || 'Bộ truyện');

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F5E6D3] text-[#3E2723] font-sans"
      onClick={() => openMenuId && setOpenMenuId(null)}
    >
      {/* HEADER BAR (1-row Google Docs Style) */}
      <header className="sticky top-0 z-30 h-14 bg-[#4E342E] text-[#F5E6D3] border-b border-[#3E2723] px-3 sm:px-6 flex items-center justify-between gap-3 shadow-sm">
        <button
          onClick={backToNovelList}
          className="flex items-center gap-2.5 shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
          title="Về danh sách bộ truyện"
        >
          <div className="w-8 h-8 rounded-lg bg-[#3E2723] border border-[#5D4037] flex items-center justify-center text-[#FFECB3]">
            <BookOpen size={17} />
          </div>
          <span className="font-bold text-sm sm:text-base tracking-tight text-[#FFECB3] whitespace-nowrap">
            Kho Truyện
          </span>
        </button>

        {/* Search */}
        <div className="flex-1 max-w-xl">
          <div className="relative flex items-center">
            <Search size={15} className="absolute left-3 text-[#D7CCC8] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={selectedNovelFilter ? `Tìm chương trong "${selectedNovelName}"...` : 'Tìm kiếm bộ truyện...'}
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-[#3E2723] border border-[#5D4037] text-xs sm:text-sm text-[#FFFDF7] placeholder:text-[#BCAAA4] outline-none focus:border-[#FFECB3]/60 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-[#D7CCC8] hover:text-white"
                title="Xóa tìm kiếm"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <AuthPanel />
        </div>
      </header>

      {/* UPPER BAND: CẤP 1 (BỘ TRUYỆN) HOẶC CẤP 2 (BÊN TRONG 1 TRUYỆN) */}
      <section className="bg-[#EFE5D9] border-b border-[#D7CCC8]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4">
          {!selectedNovelFilter ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-sm sm:text-base font-bold text-[#3E2723]">
                  Các bộ truyện của bạn
                </h1>
                <p className="text-xs text-[#795548] mt-0.5">
                  Chọn một bộ truyện để xem và mở các chương bên trong.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isSignedIn && (
                  <button
                    onClick={() => {
                      setNewNovelName('');
                      setNovelError(null);
                      setShowCreateNovel(true);
                    }}
                    className="h-9 px-4 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] text-[#FFECB3] text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <FolderPlus size={15} />
                    <span>Tạo truyện mới</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={backToNovelList}
                  className="h-8 px-2.5 rounded-lg border border-[#BCAAA4] bg-[#FFFDF7] hover:bg-white text-[#4E342E] text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                >
                  <ArrowLeft size={14} />
                  <span>Các bộ truyện</span>
                </button>
                <ChevronRight size={15} className="text-[#8D6E63] shrink-0" />
                {editingNovelId === selectedNovelFilter ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editingNovelName}
                      onChange={(e) => setEditingNovelName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveNovelRename(selectedNovelFilter);
                        if (e.key === 'Escape') setEditingNovelId(null);
                      }}
                      autoFocus
                      className="w-44 px-2 py-1 text-sm font-bold rounded border border-[#8D6E63] bg-white text-[#3E2723] outline-none"
                    />
                    <button
                      onClick={() => handleSaveNovelRename(selectedNovelFilter)}
                      className="p-1 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                      title="Lưu tên"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h1 className="text-sm sm:text-base font-bold text-[#3E2723] truncate">
                      {selectedNovelName}
                    </h1>
                    {isSignedIn && selectedNovelFilter !== '__uncategorized__' && (
                      <button
                        onClick={() => {
                          setEditingNovelId(selectedNovelFilter);
                          setEditingNovelName(selectedNovelName);
                        }}
                        className="p-1 rounded text-[#8D6E63] hover:text-[#3E2723] hover:bg-white/60 transition-colors cursor-pointer"
                        title="Đổi tên truyện"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openCreateChapterModal(selectedNovelFilter === '__uncategorized__' ? undefined : selectedNovelFilter)}
                  className="h-9 px-4 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] text-[#FFECB3] text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Plus size={16} />
                  <span>Tạo chương mới</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-5">
        {!selectedNovelFilter ? (
          /* CẤP 1: HIỂN THỊ DANH SÁCH CÁC BỘ TRUYỆN TRƯỚC */
          <>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="text-xs font-bold text-[#6D4C41] uppercase tracking-wider tabular-nums">
                Tổng cộng {filteredNovels.length + (uncategorizedCount > 0 ? 1 : 0)} bộ truyện
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'recent' | 'name')}
                  className="h-8 px-2.5 rounded-lg border border-[#D7CCC8] bg-[#FFFDF7] text-xs font-medium text-[#3E2723] outline-none cursor-pointer"
                >
                  <option value="recent">Hoạt động gần đây</option>
                  <option value="name">Tên truyện A → Z</option>
                </select>

                <div className="flex bg-[#EFE5D9] p-0.5 rounded-lg border border-[#D7CCC8]">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      viewMode === 'grid' ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs' : 'text-[#8D6E63] hover:text-[#3E2723]'
                    }`}
                    title="Dạng lưới"
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      viewMode === 'list' ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs' : 'text-[#8D6E63] hover:text-[#3E2723]'
                    }`}
                    title="Dạng danh sách"
                  >
                    <List size={15} />
                  </button>
                </div>
              </div>
            </div>

            {isLoadingData && novels.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl p-4 animate-pulse space-y-3">
                    <div className="h-9 w-9 rounded-lg bg-[#EFEBE9]" />
                    <div className="h-4 bg-[#D7CCC8]/80 rounded w-2/3" />
                    <div className="h-3 bg-[#D7CCC8]/50 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : filteredNovels.length === 0 && uncategorizedCount === 0 ? (
              <div className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl py-16 px-6 text-center max-w-lg mx-auto mt-6">
                <div className="w-12 h-12 rounded-xl bg-[#EFE5D9] text-[#5D4037] flex items-center justify-center mx-auto mb-3">
                  <FolderOpen size={22} />
                </div>
                <h2 className="text-base font-bold text-[#3E2723] mb-1">
                  {searchQuery ? 'Không tìm thấy bộ truyện phù hợp' : 'Chưa có bộ truyện nào'}
                </h2>
                <p className="text-xs text-[#795548] mb-5 leading-relaxed">
                  {searchQuery
                    ? 'Thử nhập từ khóa khác để tìm bộ truyện.'
                    : isSignedIn
                      ? 'Tạo bộ truyện đầu tiên để bắt đầu quản lý các chương và bản edit của bạn.'
                      : 'Đăng nhập để tải các bộ truyện đã đồng bộ hoặc tạo chương mới trực tiếp.'}
                </p>
                {isSignedIn && !searchQuery ? (
                  <button
                    onClick={() => {
                      setNewNovelName('');
                      setNovelError(null);
                      setShowCreateNovel(true);
                    }}
                    className="h-9 px-4 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] text-[#FFECB3] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderPlus size={15} />
                    <span>Tạo truyện đầu tiên</span>
                  </button>
                ) : !isSignedIn && !searchQuery ? (
                  <button
                    onClick={() => openCreateChapterModal(undefined)}
                    className="h-9 px-4 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] text-[#FFECB3] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus size={15} />
                    <span>Tạo chương mới</span>
                  </button>
                ) : null}
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredNovels.map(novel => {
                  const activeCount = novelStats.activeCounts.get(novel.id) || 0;
                  const trashCount = novelStats.trashCounts.get(novel.id) || 0;
                  const lastTs = novelStats.latestTs.get(novel.id);
                  const isEditingThis = editingNovelId === novel.id;

                  return (
                    <div
                      key={novel.id}
                      onClick={() => !isEditingThis && openNovelFolder(novel.id)}
                      className="group bg-[#FFFDF7] border border-[#D7CCC8] hover:border-[#8D6E63] hover:shadow-md rounded-xl p-4 transition-all cursor-pointer flex flex-col justify-between gap-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-10 h-10 rounded-lg bg-[#EFE5D9] text-[#4E342E] flex items-center justify-center shrink-0">
                          <BookOpen size={20} />
                        </div>
                        {isSignedIn && !isEditingThis && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNovelId(novel.id);
                              setEditingNovelName(novel.name);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-[#8D6E63] hover:text-[#3E2723] hover:bg-[#EFEBE9] transition-all cursor-pointer"
                            title="Đổi tên truyện"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>

                      <div className="min-w-0">
                        {isEditingThis ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingNovelName}
                              onChange={(e) => setEditingNovelName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveNovelRename(novel.id);
                                if (e.key === 'Escape') setEditingNovelId(null);
                              }}
                              autoFocus
                              className="w-full px-2 py-1 text-sm font-bold rounded border border-[#8D6E63] bg-white text-[#3E2723] outline-none"
                            />
                            <button
                              onClick={() => handleSaveNovelRename(novel.id)}
                              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                            >
                              <Check size={14} />
                            </button>
                          </div>
                        ) : (
                          <h2 className="text-sm font-bold text-[#3E2723] truncate" title={novel.name}>
                            {novel.name}
                          </h2>
                        )}
                        <div className="text-xs text-[#795548] mt-1 tabular-nums truncate">
                          {activeCount} chương{trashCount > 0 ? ` · ${trashCount} trong thùng rác` : ''}
                          {lastTs ? ` · ${formatTimestamp(lastTs)}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {uncategorizedCount > 0 && !searchQuery && (
                  <div
                    onClick={() => openNovelFolder('__uncategorized__')}
                    className="group bg-[#FFFDF7] border border-[#D7CCC8] hover:border-[#8D6E63] hover:shadow-md rounded-xl p-4 transition-all cursor-pointer flex flex-col justify-between gap-4"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#EFE5D9] text-[#795548] flex items-center justify-center shrink-0">
                      <FolderOpen size={20} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-[#3E2723] truncate">Chưa phân loại</h2>
                      <div className="text-xs text-[#795548] mt-1 tabular-nums">
                        {novelStats.activeCounts.get('__uncategorized__') || 0} chương
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl overflow-hidden divide-y divide-[#EFEBE9]">
                <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2.5 bg-[#EFE5D9]/60 text-[11px] font-bold text-[#6D4C41] uppercase tracking-wider">
                  <div className="col-span-6">Tên bộ truyện</div>
                  <div className="col-span-3 text-right">Số chương</div>
                  <div className="col-span-3 text-right">Cập nhật</div>
                </div>
                {filteredNovels.map(novel => {
                  const activeCount = novelStats.activeCounts.get(novel.id) || 0;
                  const lastTs = novelStats.latestTs.get(novel.id);
                  const isEditingThis = editingNovelId === novel.id;

                  return (
                    <div
                      key={novel.id}
                      onClick={() => !isEditingThis && openNovelFolder(novel.id)}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center px-4 py-3 min-h-[46px] hover:bg-[#F5E6D3]/50 transition-colors cursor-pointer"
                    >
                      <div className="sm:col-span-6 flex items-center gap-2.5 min-w-0">
                        <BookOpen size={16} className="text-[#5D4037] shrink-0" />
                        {isEditingThis ? (
                          <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingNovelName}
                              onChange={(e) => setEditingNovelName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveNovelRename(novel.id);
                                if (e.key === 'Escape') setEditingNovelId(null);
                              }}
                              autoFocus
                              className="w-full px-2 py-0.5 text-xs font-bold rounded border border-[#8D6E63] bg-white text-[#3E2723] outline-none"
                            />
                            <button
                              onClick={() => handleSaveNovelRename(novel.id)}
                              className="p-1 text-emerald-700"
                            >
                              <Check size={13} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-sm font-bold text-[#3E2723] truncate">{novel.name}</span>
                        )}
                      </div>
                      <div className="sm:col-span-3 text-xs text-[#5D4037] sm:text-right font-mono tabular-nums">
                        {activeCount} chương
                      </div>
                      <div className="sm:col-span-3 flex items-center justify-between sm:justify-end gap-2" onClick={e => e.stopPropagation()}>
                        <span className="text-xs text-[#795548] font-mono tabular-nums">
                          {lastTs ? formatTimestamp(lastTs) : '—'}
                        </span>
                        {isSignedIn && (
                          <button
                            onClick={() => {
                              setEditingNovelId(novel.id);
                              setEditingNovelName(novel.name);
                            }}
                            className="p-1.5 rounded text-[#8D6E63] hover:text-[#3E2723] hover:bg-[#EFEBE9] cursor-pointer"
                            title="Đổi tên"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {uncategorizedCount > 0 && !searchQuery && (
                  <div
                    onClick={() => openNovelFolder('__uncategorized__')}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center px-4 py-3 min-h-[46px] hover:bg-[#F5E6D3]/50 transition-colors cursor-pointer"
                  >
                    <div className="sm:col-span-6 flex items-center gap-2.5 min-w-0">
                      <FolderOpen size={16} className="text-[#8D6E63] shrink-0" />
                      <span className="text-sm font-bold text-[#3E2723] truncate">Chưa phân loại</span>
                    </div>
                    <div className="sm:col-span-3 text-xs text-[#5D4037] sm:text-right font-mono tabular-nums">
                      {novelStats.activeCounts.get('__uncategorized__') || 0} chương
                    </div>
                    <div className="sm:col-span-3 text-xs text-[#795548] sm:text-right font-mono tabular-nums">—</div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* CẤP 2: ĐÃ BẤM VÀO 1 BỘ TRUYỆN -> HIỆN CÁC CHƯƠNG CỦA TRUYỆN ĐÓ */
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                {/* Active / Trash Tab */}
                <div className="flex bg-[#EFE5D9] p-0.5 rounded-lg border border-[#D7CCC8]">
                  <button
                    onClick={() => {
                      setActiveTab('active');
                      setConfirmEmptyTrash(false);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'active'
                        ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs'
                        : 'text-[#795548] hover:text-[#3E2723]'
                    }`}
                  >
                    Đang hoạt động
                    <span className="ml-1.5 font-mono tabular-nums opacity-70">
                      {currentNovelActiveCount}
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveTab('trash')}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'trash'
                        ? 'bg-[#FFFDF7] text-[#C62828] shadow-xs'
                        : 'text-[#795548] hover:text-[#3E2723]'
                    }`}
                  >
                    <Trash2 size={13} />
                    <span>Thùng rác</span>
                    <span className="font-mono tabular-nums opacity-75">{currentNovelTrashCount}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeTab === 'active' && filteredChapters.length > 0 && (
                  <button
                    onClick={openZipExportModal}
                    className="h-8 px-3 rounded-lg border border-[#D7CCC8] bg-[#FFFDF7] hover:bg-white text-[#4E342E] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Xuất nhiều chương ra file ZIP"
                  >
                    <FolderDown size={14} />
                    <span className="hidden sm:inline">Xuất ZIP</span>
                  </button>
                )}

                {activeTab === 'trash' && currentNovelTrashCount > 0 && (
                  confirmEmptyTrash ? (
                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
                      <span className="text-xs text-red-800 font-medium">Xóa vĩnh viễn tất cả?</span>
                      <button
                        onClick={async () => {
                          setConfirmEmptyTrash(false);
                          await onEmptyTrash();
                        }}
                        className="px-2 py-0.5 rounded bg-red-600 text-white text-xs font-bold hover:bg-red-700 cursor-pointer"
                      >
                        Xóa hết
                      </button>
                      <button
                        onClick={() => setConfirmEmptyTrash(false)}
                        className="px-2 py-0.5 rounded bg-white text-[#3E2723] border border-[#D7CCC8] text-xs font-medium cursor-pointer"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmEmptyTrash(true)}
                      className="h-8 px-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 size={13} />
                      <span>Dọn sạch thùng rác</span>
                    </button>
                  )
                )}

                {/* Sort */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'recent' | 'name')}
                  className="h-8 px-2.5 rounded-lg border border-[#D7CCC8] bg-[#FFFDF7] text-xs font-medium text-[#3E2723] outline-none cursor-pointer"
                >
                  <option value="recent">Mở gần đây nhất</option>
                  <option value="name">Tên chương A → Z</option>
                </select>

                {/* View mode toggle */}
                <div className="flex bg-[#EFE5D9] p-0.5 rounded-lg border border-[#D7CCC8]">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      viewMode === 'grid' ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs' : 'text-[#8D6E63] hover:text-[#3E2723]'
                    }`}
                    title="Dạng lưới (Google Docs)"
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                      viewMode === 'list' ? 'bg-[#FFFDF7] text-[#3E2723] shadow-xs' : 'text-[#8D6E63] hover:text-[#3E2723]'
                    }`}
                    title="Dạng danh sách"
                  >
                    <List size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* CONTENT STATES */}
            {isLoadingData && chapters.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl overflow-hidden animate-pulse">
                    <div className="h-36 bg-[#EFEBE9]/60 p-4 space-y-2">
                      <div className="h-3 bg-[#D7CCC8]/70 rounded w-3/4" />
                      <div className="h-3 bg-[#D7CCC8]/50 rounded w-full" />
                      <div className="h-3 bg-[#D7CCC8]/50 rounded w-5/6" />
                    </div>
                    <div className="p-3.5 border-t border-[#EFEBE9] space-y-2">
                      <div className="h-4 bg-[#D7CCC8]/80 rounded w-2/3" />
                      <div className="h-3 bg-[#D7CCC8]/50 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredChapters.length === 0 ? (
              <div className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl py-16 px-6 text-center max-w-lg mx-auto mt-6">
                <div className="w-12 h-12 rounded-xl bg-[#EFE5D9] text-[#5D4037] flex items-center justify-center mx-auto mb-3">
                  {activeTab === 'trash' ? <Trash2 size={22} /> : <FileText size={22} />}
                </div>
                <h2 className="text-base font-bold text-[#3E2723] mb-1">
                  {activeTab === 'trash'
                    ? 'Thùng rác đang trống'
                    : searchQuery
                      ? 'Không tìm thấy chương phù hợp'
                      : 'Truyện này chưa có chương nào'}
                </h2>
                <p className="text-xs text-[#795548] mb-5 leading-relaxed">
                  {activeTab === 'trash'
                    ? 'Các chương chuyển vào thùng rác sẽ được giữ lại 30 ngày trước khi xóa vĩnh viễn.'
                    : searchQuery
                      ? 'Thử đổi từ khóa tìm kiếm.'
                      : 'Tạo chương mới để dán Raw, phân tích và lưu lại trong bộ truyện này.'}
                </p>
                {activeTab === 'active' && !searchQuery && (
                  <button
                    onClick={() => openCreateChapterModal(selectedNovelFilter === '__uncategorized__' ? undefined : selectedNovelFilter)}
                    className="h-9 px-4 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] text-[#FFECB3] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus size={15} />
                    <span>Tạo chương đầu tiên</span>
                  </button>
                )}
              </div>
            ) : viewMode === 'grid' ? (
          /* GRID VIEW (Google Docs Cards) */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredChapters.map(chapter => {
              const totalSegs = chapter.result?.segments?.length || 0;
              const doneCount = (chapter.completedSegments || []).filter(idx => idx >= 0 && idx < totalSegs).length;
              const progressPct = totalSegs > 0 ? Math.round((doneCount / totalSegs) * 100) : 0;
              const novelName = chapter.novelId ? (novelMap.get(chapter.novelId) || 'Truyện khác') : 'Chưa phân loại';
              const isEditing = editingChapterId === chapter.id;
              const menuOpen = openMenuId === chapter.id;

              return (
                <div
                  key={chapter.id}
                  onClick={() => {
                    if (activeTab === 'active' && !isEditing) {
                      onOpenChapter(chapter);
                    }
                  }}
                  className={`group relative bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl transition-all flex flex-col ${
                    activeTab === 'active'
                      ? 'hover:border-[#8D6E63] hover:shadow-md cursor-pointer'
                      : 'opacity-90'
                  }`}
                >
                  {/* Document Paper Preview */}
                  <div className="h-36 p-4 bg-[#FFFDF7] rounded-t-xl border-b border-[#EFEBE9] overflow-hidden relative">
                    <p className="text-xs leading-relaxed text-[#5D4037] whitespace-pre-line line-clamp-5 select-none">
                      {getChapterPreview(chapter)}
                    </p>
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#FFFDF7] to-transparent pointer-events-none" />
                  </div>

                  {/* Card Footer */}
                  <div className="p-3.5 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <FileText size={16} className={activeTab === 'trash' ? 'text-[#BCAAA4] shrink-0' : 'text-[#5D4037] shrink-0'} />
                        {isEditing ? (
                          <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingChapterName}
                              onChange={(e) => setEditingChapterName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveChapterRename(chapter.id);
                                if (e.key === 'Escape') setEditingChapterId(null);
                              }}
                              autoFocus
                              className="w-full px-1.5 py-0.5 text-xs font-bold rounded border border-[#8D6E63] bg-white text-[#3E2723] outline-none"
                            />
                            <button
                              onClick={() => handleSaveChapterRename(chapter.id)}
                              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
                              title="Lưu"
                            >
                              <Check size={13} />
                            </button>
                          </div>
                        ) : (
                          <h3 className="text-sm font-bold text-[#3E2723] truncate" title={chapter.name}>
                            {chapter.name}
                          </h3>
                        )}
                      </div>

                      {/* Menu button */}
                      <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setOpenMenuId(menuOpen ? null : chapter.id)}
                          className="p-1 rounded-md text-[#8D6E63] hover:text-[#3E2723] hover:bg-[#EFEBE9] transition-colors cursor-pointer"
                          title="Tùy chọn"
                        >
                          <MoreVertical size={15} />
                        </button>

                        {menuOpen && (
                          <div className="absolute right-0 bottom-8 w-44 bg-white border border-[#D7CCC8] rounded-lg shadow-lg py-1 z-30 text-xs">
                            {activeTab === 'active' ? (
                              <>
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onOpenChapter(chapter);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-[#F5E6D3] text-[#3E2723] font-medium flex items-center gap-2 cursor-pointer"
                                >
                                  <BookOpen size={13} /> Mở để edit
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setEditingChapterId(chapter.id);
                                    setEditingChapterName(chapter.name);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-[#F5E6D3] text-[#3E2723] font-medium flex items-center gap-2 cursor-pointer"
                                >
                                  <Pencil size={13} /> Đổi tên chương
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    exportSingleChapterWord(chapter);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-[#F5E6D3] text-[#3E2723] font-medium flex items-center gap-2 cursor-pointer"
                                >
                                  <FileDown size={13} /> Xuất Word (.doc)
                                </button>
                                <div className="my-1 border-t border-[#EFEBE9]" />
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onMoveToTrash(chapter.id);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-red-50 text-red-700 font-medium flex items-center gap-2 cursor-pointer"
                                >
                                  <Trash2 size={13} /> Chuyển vào thùng rác
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onRestoreFromTrash(chapter.id);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-emerald-50 text-emerald-800 font-medium flex items-center gap-2 cursor-pointer"
                                >
                                  <RotateCcw size={13} /> Khôi phục chương
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    onPermanentDeleteChapter(chapter.id);
                                  }}
                                  className="w-full px-3 py-2 text-left hover:bg-red-50 text-red-700 font-medium flex items-center gap-2 cursor-pointer"
                                >
                                  <Trash2 size={13} /> Xóa vĩnh viễn
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Metadata line (zero-pill, middot separated, tabular numerals) */}
                    <div className="text-[11px] text-[#795548] truncate tabular-nums">
                      {activeTab === 'trash' ? (
                        <span className="text-red-700 font-medium">
                          {novelName} · Còn {getDaysRemaining(chapter.deletedAt)} ngày
                        </span>
                      ) : (
                        <span>
                          {novelName} · {doneCount}/{totalSegs} đoạn · {formatTimestamp(chapter.timestamp)}
                        </span>
                      )}
                    </div>

                    {/* Thin Progress Track */}
                    {activeTab === 'active' && (
                      <div className="w-full h-1 bg-[#EFEBE9] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${progressPct === 100 && totalSegs > 0 ? 'bg-emerald-600' : 'bg-[#8D6E63]'}`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* LIST VIEW (Compact Table Rows) */
          <div className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl overflow-hidden">
            <div className="divide-y divide-[#EFEBE9]">
              <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2.5 bg-[#EFE5D9]/60 text-[11px] font-bold text-[#6D4C41] uppercase tracking-wider">
                <div className="col-span-5">Tên chương</div>
                <div className="col-span-3">Bộ truyện</div>
                <div className="col-span-2 text-right">Tiến độ</div>
                <div className="col-span-2 text-right">Cập nhật</div>
              </div>

              {filteredChapters.map(chapter => {
                const totalSegs = chapter.result?.segments?.length || 0;
                const doneCount = (chapter.completedSegments || []).filter(idx => idx >= 0 && idx < totalSegs).length;
                const novelName = chapter.novelId ? (novelMap.get(chapter.novelId) || 'Truyện khác') : 'Chưa phân loại';
                const isEditing = editingChapterId === chapter.id;

                return (
                  <div
                    key={chapter.id}
                    onClick={() => activeTab === 'active' && !isEditing && onOpenChapter(chapter)}
                    className={`grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center px-4 py-2.5 min-h-[44px] transition-colors ${
                      activeTab === 'active' ? 'hover:bg-[#F5E6D3]/50 cursor-pointer' : ''
                    }`}
                  >
                    <div className="sm:col-span-5 flex items-center gap-2.5 min-w-0">
                      <FileText size={16} className="text-[#5D4037] shrink-0" />
                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingChapterName}
                            onChange={(e) => setEditingChapterName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveChapterRename(chapter.id);
                              if (e.key === 'Escape') setEditingChapterId(null);
                            }}
                            autoFocus
                            className="w-full px-2 py-0.5 text-xs font-bold rounded border border-[#8D6E63] bg-white text-[#3E2723] outline-none"
                          />
                          <button
                            onClick={() => handleSaveChapterRename(chapter.id)}
                            className="p-1 text-emerald-700"
                          >
                            <Check size={13} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm font-bold text-[#3E2723] truncate">{chapter.name}</span>
                      )}
                    </div>

                    <div className="sm:col-span-3 text-xs text-[#6D4C41] truncate">
                      {novelName}
                    </div>

                    <div className="sm:col-span-2 text-xs text-[#5D4037] sm:text-right font-mono tabular-nums">
                      {activeTab === 'trash'
                        ? `Còn ${getDaysRemaining(chapter.deletedAt)} ngày`
                        : `${doneCount}/${totalSegs} đoạn`}
                    </div>

                    <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2" onClick={e => e.stopPropagation()}>
                      <span className="text-xs text-[#795548] font-mono tabular-nums">
                        {formatTimestamp(activeTab === 'trash' ? chapter.deletedAt : chapter.timestamp)}
                      </span>
                      {activeTab === 'active' ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingChapterId(chapter.id);
                              setEditingChapterName(chapter.name);
                            }}
                            className="p-1.5 rounded text-[#8D6E63] hover:text-[#3E2723] hover:bg-[#EFEBE9] cursor-pointer"
                            title="Đổi tên"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => onMoveToTrash(chapter.id)}
                            className="p-1.5 rounded text-[#8D6E63] hover:text-red-700 hover:bg-red-50 cursor-pointer"
                            title="Chuyển vào thùng rác"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onRestoreFromTrash(chapter.id)}
                            className="p-1.5 rounded text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                            title="Khôi phục"
                          >
                            <RotateCcw size={13} />
                          </button>
                          <button
                            onClick={() => onPermanentDeleteChapter(chapter.id)}
                            className="p-1.5 rounded text-red-700 hover:bg-red-50 cursor-pointer"
                            title="Xóa vĩnh viễn"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
          </>
        )}
      </main>

      {/* CREATE NOVEL MODAL */}
      {showCreateNovel && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowCreateNovel(false)}
        >
          <form
            onSubmit={handleSubmitCreateNovel}
            onClick={e => e.stopPropagation()}
            className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#3E2723] flex items-center gap-2">
                <FolderPlus size={18} className="text-[#5D4037]" />
                Tạo bộ truyện mới
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateNovel(false)}
                className="p-1 rounded hover:bg-[#EFEBE9] text-[#8D6E63]"
              >
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5D4037] mb-1.5">
                Tên bộ truyện
              </label>
              <input
                type="text"
                value={newNovelName}
                onChange={(e) => setNewNovelName(e.target.value)}
                placeholder="Ví dụ: Quỷ Bí Chi Chủ..."
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-[#D7CCC8] bg-white text-sm text-[#3E2723] outline-none focus:border-[#4E342E]"
              />
              {novelError && (
                <p className="text-xs text-red-600 mt-1.5">{novelError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateNovel(false)}
                className="px-4 py-2 rounded-lg border border-[#D7CCC8] text-xs font-bold text-[#5D4037] hover:bg-[#EFEBE9] cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isCreatingNovel || !newNovelName.trim()}
                className="px-4 py-2 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] disabled:opacity-50 text-[#FFECB3] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {isCreatingNovel && <Loader2 size={13} className="animate-spin" />}
                Tạo truyện
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE CHAPTER MODAL */}
      {showCreateChapter && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowCreateChapter(false)}
        >
          <form
            onSubmit={handleSubmitCreateChapter}
            onClick={e => e.stopPropagation()}
            className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[#3E2723] flex items-center gap-2">
                  <FileText size={18} className="text-[#5D4037]" />
                  Tạo chương mới
                </h2>
                <p className="text-xs text-[#795548] mt-0.5">
                  Bộ truyện: <span className="font-semibold text-[#3E2723]">{createChapterNovelId ? (novelMap.get(createChapterNovelId) || 'Bộ truyện') : 'Chưa phân loại'}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateChapter(false)}
                className="p-1 rounded hover:bg-[#EFEBE9] text-[#8D6E63]"
              >
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#5D4037] mb-1.5">
                Tên chương
              </label>
              <input
                type="text"
                value={newChapterName}
                onChange={(e) => {
                  setNewChapterName(e.target.value);
                  if (chapterError) setChapterError(null);
                }}
                placeholder="Ví dụ: Chương 1: Khởi đầu..."
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-[#D7CCC8] bg-white text-sm text-[#3E2723] outline-none focus:border-[#4E342E]"
              />
              {chapterError && (
                <p className="text-xs text-red-600 mt-1.5">{chapterError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateChapter(false)}
                className="px-4 py-2 rounded-lg border border-[#D7CCC8] text-xs font-bold text-[#5D4037] hover:bg-[#EFEBE9] cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isCreatingChapter || !newChapterName.trim()}
                className="px-4 py-2 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] disabled:opacity-50 text-[#FFECB3] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {isCreatingChapter && <Loader2 size={13} className="animate-spin" />}
                Tạo & lưu kho
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BATCH ZIP EXPORT MODAL */}
      {showZipModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowZipModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#FFFDF7] border border-[#D7CCC8] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#3E2723] flex items-center gap-2">
                <FolderDown size={18} />
                Xuất file ZIP ({zipSelectedIds.size} chương)
              </h2>
              <button
                onClick={() => setShowZipModal(false)}
                className="p-1 rounded hover:bg-[#EFEBE9] text-[#8D6E63]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 text-xs text-[#3E2723]">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border border-[#EFEBE9] hover:bg-[#F5E6D3]/40">
                <input
                  type="checkbox"
                  checked={optExportTable}
                  onChange={(e) => setOptExportTable(e.target.checked)}
                />
                <span className="font-medium">Bản đối chiếu dạng bảng (Raw / VP / DeepL / Edit)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border border-[#EFEBE9] hover:bg-[#F5E6D3]/40">
                <input
                  type="checkbox"
                  checked={optExportParallel}
                  onChange={(e) => setOptExportParallel(e.target.checked)}
                />
                <span className="font-medium">Bản song ngữ (Raw + Edit)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border border-[#EFEBE9] hover:bg-[#F5E6D3]/40">
                <input
                  type="checkbox"
                  checked={optExportEdit}
                  onChange={(e) => setOptExportEdit(e.target.checked)}
                />
                <span className="font-medium">Chỉ bản Edit hoàn chỉnh</span>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowZipModal(false)}
                className="px-4 py-2 rounded-lg border border-[#D7CCC8] text-xs font-bold text-[#5D4037] hover:bg-[#EFEBE9] cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={performExportZip}
                disabled={isExportingZip || (!optExportTable && !optExportParallel && !optExportEdit)}
                className="px-4 py-2 rounded-lg bg-[#3E2723] hover:bg-[#4E342E] disabled:opacity-50 text-[#FFECB3] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {isExportingZip && <Loader2 size={13} className="animate-spin" />}
                Tải ZIP ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
