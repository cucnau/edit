
import React, { useState, useEffect, useRef } from 'react';
import { CustomTerm } from '../types';
import { Plus, Trash2, BookUser, Settings, Download, Upload, Loader2, Save, Code, Copy, Search, X, RefreshCw, FileText, CheckCircle, FileUp, AlertCircle } from 'lucide-react';
import { syncFirestoreData } from '../services/firestoreService';
import { auth } from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { vietphraseEngine } from '../services/vietphraseService';

interface DictionarySidebarProps {
  currentNovelId: string;
  terms: CustomTerm[];
  onUpdateTerms: (terms: CustomTerm[]) => void;
  sheetUrl: string;
  onUpdateSheetUrl: (url: string) => void;
  refreshTrigger?: any;
}

// Updated GAS Code to support multiple tabs
const APPS_SCRIPT_CODE = `function doGet(e) {
  var type = e.parameter.type || 'vocab';
  var sheetName = getSheetName(type);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify([]))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  // Remove header row
  if (data.length > 0) data.shift();
  
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var type = payload.type || 'vocab';
  var rows = payload.data;
  
  var sheetName = getSheetName(type);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // Add Headers based on type
    var headers = getHeaders(type);
    sheet.appendRow(headers);
  } else {
    sheet.clear();
    var headers = getHeaders(type);
    sheet.appendRow(headers);
  }
  
  if (rows && rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  
  return ContentService.createTextOutput(JSON.stringify({result: "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheetName(type) {
  if (type == 'char') return 'Characters';
  if (type == 'rel') return 'Relationships';
  return 'Vocabulary';
}

function getHeaders(type) {
  if (type == 'char') return ["ID", "Chinese Name", "Viet Name", "Pronouns", "Description"];
  if (type == 'rel') return ["ID", "Char A", "Char B", "Call A->B", "Call B->A", "Note"];
  return ["ID", "Term", "Meaning"];
}`;

export const DictionarySidebar: React.FC<DictionarySidebarProps> = ({
  currentNovelId,
  terms,
  onUpdateTerms,
  sheetUrl,
  onUpdateSheetUrl,
  refreshTrigger
}) => {
  const [newTerm, setNewTerm] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [vpCount, setVpCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Sync States
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(!!auth.currentUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsSignedIn(!!user);
    });
    return () => unsubscribe();
  }, []);

  // Fetch when novel changes
  useEffect(() => {
      if (isSignedIn && currentNovelId) {
          const timer = setTimeout(() => {
              handlePullFromCloud(true);
          }, 500);
          return () => clearTimeout(timer);
      } else if (!currentNovelId) {
          onUpdateTerms([]);
      }
  }, [currentNovelId, isSignedIn]);

  
  // Auto Sync State
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    return localStorage.getItem('autoSync_vocab') === 'true';
  });
  const isInitialMount = useRef(true);
  const isPullingRef = useRef(false); // Flag to ignore changes caused by pulling data

  // Persist autoSync preference
  useEffect(() => {
    localStorage.setItem('autoSync_vocab', String(autoSync));
  }, [autoSync]);

  // Load VP size on mount/render
  useEffect(() => {
     setVpCount(vietphraseEngine.getSize());
     return vietphraseEngine.subscribe(() => {
         setVpCount(vietphraseEngine.getSize());
     });
  }, [refreshTrigger]);

  // Auto-Pull on mount if empty
  useEffect(() => {
      // Only run if we have a user, no terms, and not currently syncing
      if (isSignedIn && terms.length === 0 && !isSyncing && !isPullingRef.current) {
          // Add a small delay to allow DB load to finish first (if any)
          const timer = setTimeout(() => {
              if (terms.length === 0) { // Check again
                  console.log("Auto-pulling from Cloud due to empty local terms...");
                  handlePullFromCloud();
              }
          }, 1000);
          return () => clearTimeout(timer);
      }
  }, [isSignedIn, terms.length]); // Re-check if terms length changes (e.g. from 0 to N via DB load)

  // AUTO SYNC LOGIC (Push)
    useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    // SAFETY: Never auto-push empty list. 
    // This prevents wiping the cloud if the local DB hasn't loaded yet or is empty.
    // User must manually "Push" if they really want to clear it.
    if (!autoSync || !isSignedIn || isPullingRef.current || terms.length === 0) return;
    
    const timer = setTimeout(() => {
      handlePushToCloud(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [terms, autoSync, isSignedIn]);


  const filteredTerms = terms.filter(t => 
    t.term.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.meaning.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = () => {
    if (!newTerm.trim() || !newMeaning.trim() || !currentNovelId) return;
    
    const newItem: CustomTerm = {
      id: Date.now().toString(),
      novelId: currentNovelId,
      term: newTerm.trim(),
      meaning: newMeaning.trim(),
    };

    onUpdateTerms([...terms, newItem]);
    setNewTerm('');
    setNewMeaning('');
  };

  const handleDelete = (id: string) => {
    onUpdateTerms(terms.filter(t => t.id !== id));
  };

  const handlePullFromCloud = async (silent = false) => {
    if (!isSignedIn) {
        if (!silent) setSyncMessage({ type: 'error', text: 'Chưa đăng nhập!' });
        return;
    }
    if (!currentNovelId) {
        if (!silent) setSyncMessage({ type: 'error', text: 'Chưa chọn truyện!' });
        return;
    }
    setIsSyncing(true);
    isPullingRef.current = true;
    if (!silent) setSyncMessage(null);
    try {
      const data = await syncFirestoreData<CustomTerm>('vocab', currentNovelId, 'GET');
      onUpdateTerms(data);
      if (!silent) setSyncMessage({ type: 'success', text: `Đã tải ${data.length} từ!` });
    } catch (e: any) {
      if (!silent) setSyncMessage({ type: 'error', text: e.message || "Lỗi tải dữ liệu" });
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isPullingRef.current = false; }, 500);
    }
  };

  const handlePushToCloud = async (silent = false) => {
    if (!isSignedIn) {
        if (!silent) setSyncMessage({ type: 'error', text: 'Chưa đăng nhập!' });
        return;
    }
    if (!currentNovelId) {
        if (!silent) setSyncMessage({ type: 'error', text: 'Chưa chọn truyện!' });
        return;
    }
    
    if (isSyncing) return;

    setIsSyncing(true);
    if (!silent) setSyncMessage(null);
    
    try {
      await syncFirestoreData<CustomTerm>('vocab', currentNovelId, 'POST', terms);
      if (!silent) setSyncMessage({ type: 'success', text: 'Đã lưu lên mây!' });
      else setSyncMessage({ type: 'success', text: 'Đã tự động lưu!' });
    } catch (e: any) {
      setSyncMessage({ type: 'error', text: e.message || "Lỗi lưu dữ liệu" });
    } finally {
      setIsSyncing(false);
      if (silent) setTimeout(() => setSyncMessage(null), 2000);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSyncMessage({ type: 'success', text: 'Đang đọc file...' });
    const reader = new FileReader();
    reader.onload = (evt) => {
        const content = evt.target?.result as string;
        if (content) {
            const count = vietphraseEngine.loadDictionary(content);
            setVpCount(count);
            setSyncMessage({ type: 'success', text: `Đã nạp ${count} từ Vietphrase` });
            setTimeout(() => setSyncMessage(null), 3000);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset to allow re-selection
  };

  return (
    <div className="flex flex-col h-full bg-[#EFE5D9] border-r border-[#D7CCC8] w-80 shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-[#D7CCC8] bg-[#D7CCC8]/30 flex items-center justify-between">
         <div className="flex items-center gap-2 text-[#3E2723] font-bold">
            <BookUser size={16} className="text-[#5D4037]" />
            <span className="text-sm">Kho Từ Vựng</span>
         </div>
         <div className="flex items-center gap-1">
            {/* Quick Button for VP status */}
            <button
                onClick={() => setShowSettings(true)}
                className={`p-1 rounded-full transition-colors flex items-center gap-1 ${vpCount > 0 ? 'text-[#3E2723] bg-[#EFE5D9] border border-[#D7CCC8]' : 'text-red-500 hover:bg-red-50 animate-pulse'}`}
                title={vpCount > 0 ? `Đã nạp ${vpCount} từ` : "Chưa có Vietphrase! Bấm để nạp"}
            >
                {vpCount > 0 ? <CheckCircle size={14} className="text-green-600" /> : <FileText size={14} />}
                {vpCount > 0 && <span className="text-[9px] font-mono">{Math.floor(vpCount/1000)}k</span>}
            </button>
            <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1 rounded-full transition-colors ${showSettings ? 'bg-[#3E2723] text-[#F5E6D3]' : 'text-[#8D6E63] hover:text-[#3E2723] hover:bg-[#D7CCC8]'}`}
                title="Cài đặt"
            >
                <Settings size={14} />
            </button>
         </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
          <div className="bg-[#EFEBE9] border-b border-[#D7CCC8] p-3 text-sm animate-in slide-in-from-top-2 overflow-y-auto max-h-[60vh]">
             
             {/* VIETPHRASE SECTION */}
             <div className="mb-4 bg-white border border-[#D7CCC8] rounded-lg p-3">
                <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-[#5D4037] uppercase flex items-center gap-1"><FileText size={12}/> Vietphrase (Offline)</label>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${vpCount > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {vpCount > 0 ? `${vpCount.toLocaleString()} từ` : 'Chưa có dữ liệu'}
                    </span>
                </div>
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 bg-[#F5E6D3] hover:bg-[#D7CCC8] text-[#3E2723] py-2 rounded border border-dashed border-[#8D6E63] transition-colors text-xs font-bold"
                >
                    <FileUp size={14} />
                    {vpCount > 0 ? "Nạp lại file khác" : "Chọn file Vietphrase.txt"}
                </button>
                <p className="text-[9px] text-[#8D6E63] mt-1.5 italic leading-tight">
                    * Dữ liệu Vietphrase được dùng để tự động điền vào dòng "Quick Trans" giúp đối chiếu bản dịch AI.
                </p>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".txt" 
                    onChange={handleFileUpload} 
                />
             </div>

             {/* CLOUD SYNC SECTION */}
             <div className="border-t border-[#D7CCC8] pt-3">
             <label className="block text-[10px] font-bold text-[#5D4037] uppercase mb-1 flex items-center gap-1"><Settings size={12}/> Đồng bộ Đám mây</label>

             {/* Auto Sync Toggle */}
             <div className="flex items-center justify-between bg-white border border-[#D7CCC8] p-2 rounded mb-2">
                 <div className="flex items-center gap-2">
                   <RefreshCw size={14} className={autoSync ? "text-green-600 animate-spin-slow" : "text-[#A1887F]"} />
                   <span className="text-xs font-medium text-[#5D4037]">Tự động đồng bộ</span>
                 </div>
                 <button 
                   onClick={() => setAutoSync(!autoSync)}
                   className={`w-8 h-4 rounded-full relative transition-colors ${autoSync ? 'bg-green-500' : 'bg-[#D7CCC8]'}`}
                 >
                   <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${autoSync ? 'left-4.5' : 'left-0.5'}`} style={{left: autoSync ? '18px' : '2px'}} />
                 </button>
               </div>
               
               {!isSignedIn && <div className="text-[10px] text-red-500 mt-1">Đăng nhập để đồng bộ dữ liệu.</div>}
             </div>

             {/* BULK IMPORT SECTION */}
             <div className="border-t border-[#D7CCC8] pt-3 mt-3">
                <label className="block text-[10px] font-bold text-[#5D4037] uppercase mb-1 flex items-center gap-1"><FileText size={12}/> Import hàng loạt</label>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder="Trung = Việt&#10;Hoặc copy từ Excel (cột Trung, cột Việt)"
                  className="w-full h-20 text-[10px] p-2 border border-[#D7CCC8] rounded bg-white outline-none resize-none mb-1"
                />
                <button 
                  onClick={() => {
                    if (!bulkText.trim() || !currentNovelId) return;
                    const lines = bulkText.split('\n');
                    const newItems: CustomTerm[] = [];
                    lines.forEach(line => {
                      if (!line.trim()) return;
                      let parts = line.split('\t');
                      if (parts.length < 2) parts = line.split(' = ');
                      if (parts.length < 2) parts = line.split('=');
                      if (parts.length < 2) parts = line.split(/\s{2,}/);
                      if (parts.length < 2) {
                          // Fallback to first space
                          const match = line.match(/^(\S+)\s+(.+)$/);
                          if (match) parts = [match[1], match[2]];
                      }
                      
                      if (parts.length >= 2) {
                        newItems.push({
                          id: Date.now().toString() + Math.random().toString(),
                          novelId: currentNovelId,
                          term: parts[0].trim(),
                          meaning: parts.slice(1).join(' ').trim() // Join remaining parts if any
                        });
                      }
                    });
                    if (newItems.length > 0) {
                        onUpdateTerms([...terms, ...newItems]);
                        setBulkText('');
                        setSyncMessage({ type: 'success', text: `Đã thêm ${newItems.length} từ!` });
                        setTimeout(() => setSyncMessage(null), 3000);
                    }
                  }}
                  className="w-full bg-[#5D4037] text-white text-[10px] py-1 rounded hover:bg-[#4E342E] transition-colors"
                >
                  Thêm vào từ điển
                </button>
             </div>
          </div>
      )}

      {/* Sync Buttons */}
      {!showSettings && (
          <div className="px-2 py-1.5 border-b border-[#D7CCC8] flex gap-2 justify-center bg-[#EFE5D9]">
             <button onClick={() => handlePullFromCloud(false)} disabled={isSyncing || !isSignedIn} className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold uppercase bg-white border border-blue-200 text-blue-700 py-1 rounded hover:bg-blue-50 shadow-sm disabled:opacity-50">
                {isSyncing ? <Loader2 className="animate-spin" size={12} /> : <Download size={12} />} Tải về
             </button>
             <button onClick={() => handlePushToCloud(false)} disabled={isSyncing || !isSignedIn} className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold uppercase bg-white border border-green-200 text-green-700 py-1 rounded hover:bg-green-50 shadow-sm disabled:opacity-50">
                {isSyncing ? <Loader2 className="animate-spin" size={12} /> : <Upload size={12} />} Đẩy lên
             </button>
          </div>
      )}
      
      {syncMessage && (
         <div className={`px-2 py-0.5 text-[10px] text-center font-bold ${syncMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} transition-all`}>
            {syncMessage.text}
         </div>
      )}

      {/* Search Bar */}
      <div className="px-2 py-1.5 border-b border-[#D7CCC8] bg-[#EFE5D9] sticky top-0 z-10">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1887F]" />
          <input 
            type="text" 
            placeholder="Tìm kiếm..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-6 py-1 text-xs bg-white border border-[#D7CCC8] rounded-full focus:ring-1 focus:ring-[#8D6E63] outline-none transition-all placeholder:text-[#D7CCC8]"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1887F] hover:text-[#5D4037]"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Table Content */}
      <div className="flex-1 overflow-y-auto bg-[#F5E6D3]">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#EFEBE9] sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="py-0.5 px-1 text-[10px] font-bold text-[#5D4037] uppercase tracking-wider w-1/2 border-r border-[#D7CCC8]">Trung</th>
              <th className="py-0.5 px-1 text-[10px] font-bold text-[#5D4037] uppercase tracking-wider w-1/2">Việt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EFEBE9] bg-white">
            {filteredTerms.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-8 text-center text-xs text-[#BCAAA4] italic">
                  {searchTerm ? 'Không tìm thấy kết quả' : 'Chưa có dữ liệu'}
                </td>
              </tr>
            ) : (
              filteredTerms.map((item) => (
                <tr key={item.id} className="group hover:bg-[#FFF8E1] transition-colors">
                  <td className="py-0.5 px-1 text-[11px] font-serif-sc font-medium text-[#3E2723] align-top relative border-r border-[#EFEBE9] leading-tight">
                     {item.term}
                  </td>
                  <td className="py-0.5 px-1 text-[11px] text-[#4E342E] align-top relative leading-tight">
                     <span className="font-medium text-[#795548]">{item.meaning}</span>
                     {/* Delete Button */}
                     <button
                        onClick={() => handleDelete(item.id)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 bg-white shadow-sm border border-[#D7CCC8] rounded text-[#BCAAA4] hover:text-[#D32F2F] opacity-0 group-hover:opacity-100 transition-all z-10"
                        title="Xóa"
                      >
                        <Trash2 size={10} />
                      </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add New */}
      <div className="p-1 border-t border-[#D7CCC8] bg-[#EFE5D9] space-y-1">
         <div className="flex gap-1">
            <input
                type="text"
                placeholder="Từ gốc"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                className="w-1/2 px-1 py-0.5 text-[10px] border border-[#D7CCC8] rounded outline-none focus:border-[#8D6E63] font-serif-sc"
            />
            <input
               type="text"
               placeholder="Nghĩa TV"
               value={newMeaning}
               onChange={(e) => setNewMeaning(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
               className="w-1/2 px-1 py-0.5 text-[10px] border border-[#D7CCC8] rounded outline-none focus:border-[#8D6E63]"
            />
         </div>
         <button 
            onClick={handleAdd}
            disabled={!newTerm.trim() || !newMeaning.trim()}
            className="w-full bg-[#3E2723] text-[#F5E6D3] py-0.5 rounded text-[10px] font-bold uppercase hover:bg-[#4E342E] disabled:opacity-50 flex justify-center items-center gap-1 shadow-sm"
         >
            <Plus size={10} /> Thêm
         </button>
      </div>
    </div>
  );
};
