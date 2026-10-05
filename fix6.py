with open("components/DictionarySidebar.tsx", "r") as f:
    text = f.read()

# Fix onExportExcel
text = text.replace("</button>\n                        <button\n                onClick={() => setShowSettings(!showSettings)}", "</button>)}\n                        <button\n                onClick={() => setShowSettings(!showSettings)}")

# Fix showSettings
text = text.replace("              </div>\n             </div>\n          </div>\n      {/* Search Bar */}", "              </div>\n             </div>\n          </div>\n      )}\n      {/* Search Bar */}")

# Fix syncMessage
text = text.replace("            </div>\n         </div>\n      {/* Search Bar */}", "            </div>\n         </div>\n      )}\n      {/* Search Bar */}")

with open("components/DictionarySidebar.tsx", "w") as f:
    f.write(text)
