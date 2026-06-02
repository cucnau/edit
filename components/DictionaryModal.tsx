import React, { useState } from 'react';
import { CustomTerm } from '../types';
import { X, Plus, Trash2, BookUser, Settings, Download, Upload, Loader2, Save, Code, Copy, Info } from 'lucide-react';
import { fetchTermsFromSheet, saveTermsToSheet } from '../services/sheetService';

interface DictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  terms: CustomTerm[];
  onUpdateTerms: (terms: CustomTerm[]) => void;
  sheetUrl: string;
  onUpdateSheetUrl: (url: string) => void;
}

const APPS_SCRIPT_CODE = `function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var terms = [];
  // Bỏ qua dòng tiêu đề (index 0), bắt đầu từ index 1
  for (var i = 1; i < data.length; i++) {
    // Chỉ cần cột Term (index 1) có dữ liệu là lấy
    if (data[i][1]) {
      var id = data[i][0] ? data[i][0].toString() : ("auto_" + i + "_" + Date.now());
      terms.push({
        id: id,
        term: data[i][1].toString(),
        meaning: data[i][2] ? data[i][2].toString() : ""
      });
    }
  }
  return ContentService.createTextOutput(JSON.stringify(terms))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var terms = JSON.parse(e.postData.contents);
  
  sheet.clear(); // Xóa cũ
  sheet.appendRow(["ID", "Term", "Meaning"]); // Ghi header
  
  var rows = terms.map(function(t) {
    return [t.id, t.term, t.meaning];
  });
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  
  return ContentService.createTextOutput(JSON.stringify({result: "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export const DictionaryModal: React.FC<DictionaryModalProps> = ({
  isOpen,
  onClose,
  terms,
  onUpdateTerms,
  sheetUrl,
  onUpdateSheetUrl
}) => {
  const [newTerm, setNewTerm] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [tempUrl, setTempUrl] = useState(sheetUrl);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (!newTerm.trim() || !newMeaning.trim()) return;
    
    const newItem: CustomTerm = {
      id: Date.now().toString(),
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

  const handleSaveUrl = () => {
    onUpdateSheetUrl(tempUrl);
    setShowSettings(false);
    setSyncMessage({ type: 'success', text: 'Đã lưu URL!' });
    setTimeout(() => setSyncMessage(null), 3000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(APPS_SCRIPT_CODE);
    setSyncMessage({ type: 'success', text: 'Đã sao chép mã!' });
    setTimeout(() => setSyncMessage(null), 2000);
  };

  const handlePullFromSheet = async () => {
    if (!sheetUrl) {
        setSyncMessage({ type: 'error', text: 'Chưa có URL Sheet!' });
        return;
    }
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const data = await fetchTermsFromSheet(sheetUrl);
      onUpdateTerms(data);
      setSyncMessage({ type: 'success', text: `Đã tải thành công ${data.length} từ!` });
    } catch (e: any) {
      setSyncMessage({ type: 'error', text: e.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePushToSheet = async () => {
    if (!sheetUrl) {
        setSyncMessage({ type: 'error', text: 'Chưa có URL Sheet!' });
        return;
    }
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      await saveTermsToSheet(sheetUrl, terms);
      setSyncMessage({ type: 'success', text: 'Đã lưu thành công lên Sheet!' });
    } catch (e: any) {
      setSyncMessage({ type: 'error', text: e.message });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex justify-between items-center bg-stone-50">
          <div className="flex items-center gap-2 text-stone-800">
            <BookUser size={20} className="text-red-700" />
            <h2 className="text-lg font-bold">Kho Từ Vựng Cá Nhân</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-full transition-colors ${showSettings ? 'bg-stone-200 text-stone-800' : 'text-stone-400 hover:text-stone-600 hover:bg-stone-200'}`}
              title="Cài đặt kết nối Sheet"
            >
              <Settings size={20} />
            </button>
            <button 
              onClick={onClose}
              className="text-stone-400 hover:text-stone-600 hover:bg-stone-200 p-1.5 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Sync / Settings Area */}
        {showSettings && (
          <div className="bg-stone-100 border-b border-stone-200 p-4 animate-in slide-in-from-top-2 overflow-y-auto max-h-[40vh]">
             <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Google Apps Script URL</label>
             <div className="flex gap-2 mb-3">
               <input 
                 type="text" 
                 value={tempUrl}
                 onChange={(e) => setTempUrl(e.target.value)}
                 placeholder="https://script.google.com/macros/s/.../exec"
                 className="flex-1 px-3 py-1.5 text-sm border border-stone-300 rounded focus:ring-2 focus:ring-red-500 outline-none"
               />
               <button 
                onClick={handleSaveUrl}
                className="bg-stone-800 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-stone-700"
               >
                 <Save size={16} />
               </button>
             </div>
             
             <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-sm text-stone-700 mb-2">
                <div className="flex items-start gap-2">
                  <Info size={16} className="text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="mb-1 font-semibold text-blue-800">Cập nhật Script (Quan trọng)</p>
                    <p className="text-xs mb-2">
                      Để đọc được dữ liệu thiếu cột ID (như copy từ Excel), bạn cần cập nhật đoạn mã bên dưới vào Google Apps Script.
                    </p>
                    <button 
                      onClick={() => setShowCode(!showCode)}
                      className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                    >
                      <Code size={12} /> {showCode ? 'Ẩn mã' : 'Xem mã Script mới'}
                    </button>
                  </div>
                </div>
             </div>

             {showCode && (
               <div className="relative mt-2">
                 <pre className="bg-stone-800 text-stone-100 p-3 rounded text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
                   {APPS_SCRIPT_CODE}
                 </pre>
                 <button 
                  onClick={handleCopyCode}
                  className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded text-white transition-colors"
                  title="Sao chép"
                 >
                   <Copy size={14} />
                 </button>
               </div>
             )}
          </div>
        )}

        {/* Sync Controls (Always visible if URL exists) */}
        {sheetUrl && !showSettings && (
             <div className="bg-blue-50/50 border-b border-blue-100 p-3 flex justify-between items-center">
                 <div className="flex gap-2">
                    <button 
                        onClick={handlePullFromSheet}
                        disabled={isSyncing}
                        className="flex items-center gap-1 text-xs font-medium bg-white border border-blue-200 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                        {isSyncing ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
                        Tải về
                    </button>
                    <button 
                        onClick={handlePushToSheet}
                        disabled={isSyncing}
                        className="flex items-center gap-1 text-xs font-medium bg-white border border-green-200 text-green-700 px-3 py-1.5 rounded hover:bg-green-50 transition-colors disabled:opacity-50"
                    >
                        {isSyncing ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
                        Đẩy lên
                    </button>
                 </div>
                 {syncMessage && (
                     <span className={`text-xs font-medium ${syncMessage.type === 'success' ? 'text-green-600' : 'text-red-600'} animate-in fade-in`}>
                         {syncMessage.text}
                     </span>
                 )}
             </div>
        )}

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#f8f7f5]">
          <div className="space-y-3">
            {terms.length === 0 ? (
              <div className="text-center py-8 text-stone-400 italic border-2 border-dashed border-stone-200 rounded-lg">
                Chưa có từ vựng nào.
                <br />
                <span className="text-xs">Thêm thủ công hoặc tải từ Sheet.</span>
              </div>
            ) : (
              terms.map((item) => (
                <div key={item.id} className="bg-white p-3 rounded-lg shadow-sm border border-stone-200 flex justify-between items-center group">
                  <div className="flex items-baseline gap-3">
                    <span className="font-serif-sc font-bold text-lg text-stone-800">{item.term}</span>
                    <span className="text-stone-400 text-sm">➔</span>
                    <span className="font-medium text-red-700">{item.meaning}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-stone-400 hover:text-red-600 p-1.5 opacity-0 group-hover:opacity-100 transition-all"
                    title="Xóa"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Input Footer */}
        <div className="p-4 border-t border-stone-200 bg-white">
          <div className="flex gap-2 mb-2">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Từ tiếng Trung (VD: 摆烂)"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none text-sm font-serif-sc"
              />
            </div>
            <div className="flex-1">
              <input
                type="text"
                placeholder="Nghĩa của bạn"
                value={newMeaning}
                onChange={(e) => setNewMeaning(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!newTerm.trim() || !newMeaning.trim()}
              className="bg-stone-900 text-white px-4 py-2 rounded-md hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};