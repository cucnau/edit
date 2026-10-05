import re
with open("components/DictionarySidebar.tsx", "r") as f:
    text = f.read()

# Fix syncMessage block
text = re.sub(r'\{syncMessage && \([\s\S]*?</div>[\s\n\)\}]*\{/\* Search', 
    r'{syncMessage && (\n         <div className={`px-2 py-0.5 text-[10px] text-center font-bold ${syncMessage.type === \'success\' ? \'bg-green-100 text-green-700\' : \'bg-red-100 text-red-700\'} transition-all`}>\n            {syncMessage.text}\n         </div>\n      )}\n      {/* Search', text)

# Fix searchTerm block
text = re.sub(r'\{searchTerm && \([\s\S]*?</button>[\s\n]*</div>\n      </div>\n      \{/\* Table Content',
    r'{searchTerm && (\n            <button \n              onClick={() => setSearchTerm(\'\')}\n              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1887F] hover:text-[#5D4037]"\n            >\n              <X size={10} />\n            </button>\n          )}\n        </div>\n      </div>\n      {/* Table Content', text)

# Fix !showSettings block (Sync Buttons)
text = re.sub(r'\{!showSettings && \([\s\S]*?</button>\n             </div>\n          </div>',
    r'{!showSettings && (\n          <div className="px-2 py-1.5 border-b border-[#D7CCC8] flex flex-col gap-1.5 bg-[#EFE5D9]">\n             <div className="flex gap-2 justify-center">\n                <button onClick={() => handlePullFromCloud(false)} disabled={isSyncing || !isSignedIn} className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold uppercase bg-white border border-blue-200 text-blue-700 py-1 rounded hover:bg-blue-50 shadow-sm disabled:opacity-50">\n                   {isSyncing ? <Loader2 className="animate-spin" size={12} /> : <Download size={12} />} Tải về\n                </button>\n                <button onClick={() => handlePushToCloud(false)} disabled={isSyncing || !isSignedIn} className="flex-1 flex items-center justify-center gap-1 text-[10px] font-bold uppercase bg-white border border-green-200 text-green-700 py-1 rounded hover:bg-green-50 shadow-sm disabled:opacity-50">\n                   {isSyncing ? <Loader2 className="animate-spin" size={12} /> : <Upload size={12} />} Đẩy lên\n                </button>\n             </div>\n          </div>\n      )}', text)

# Fix filteredTerms empty state
text = re.sub(r'              \)\)\n[\s\S]*?</tbody>',
    r'              ))}\n            )}\n          </tbody>', text)

# Fix disabled={!newTerm.trim() || !newMeaning.trim(
text = text.replace('disabled={!newTerm.trim() || !newMeaning.trim(', 'disabled={!newTerm.trim() || !newMeaning.trim()}')

# Remove extraneous )}
text = text.replace('              </button>)}\n                        <button', '              </button>\n                        <button')

with open("components/DictionarySidebar.tsx", "w") as f:
    f.write(text)
