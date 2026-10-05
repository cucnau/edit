with open("components/DictionarySidebar.tsx", "r") as f:
    lines = f.readlines()

# 354: {onExportExcel && (
# 367:             <button
# 368:               onClick={() => setShowSettings(!showSettings)}
# Let's find the closing for onExportExcel. It should be before the next <button> at same indent.
for i in range(350, 370):
    if "<FileSpreadsheet" in lines[i]:
        # The button for export excel closes at i+2
        lines[i+1] = lines[i+1].rstrip() + ")}\n"
        break

# 372: {showSettings && (
# It closes right before {/* Search Bar */}
for i in range(400, 600):
    if "{/* Search Bar */}" in lines[i]:
        lines.insert(i, "      )}\n")
        break

# 523: {syncMessage && (
# It closes after the div
for i in range(500, 550):
    if "syncMessage && (" in lines[i]:
        # It's a single div
        lines.insert(i+5, "      )}\n")
        break

# 616: filteredTerms.length === 0 ? ( ... ) : (
# It closes at the end of the table
for i in range(600, 630):
    if "</tbody>" in lines[i]:
        lines[i] = "            )\n" + lines[i]
        break

with open("components/DictionarySidebar.tsx", "w") as f:
    f.writelines(lines)
