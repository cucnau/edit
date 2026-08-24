import { TextShortcut } from '../types';

const STORAGE_KEY = 'edit_shortcuts_v1';
const ENABLED_STORAGE_KEY = 'edit_shortcuts_enabled';

export const DEFAULT_SHORTCUTS: TextShortcut[] = [];

export const getStoredShortcuts = (): TextShortcut[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (err) {
    console.warn("Could not read shortcuts from localStorage", err);
    return [];
  }
};

export const saveStoredShortcuts = (shortcuts: TextShortcut[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
    window.dispatchEvent(new CustomEvent('shortcuts_updated', { detail: shortcuts }));
  } catch (err) {
    console.error("Could not save shortcuts to localStorage", err);
  }
};

export const isShortcutsEnabled = (): boolean => {
  try {
    const val = localStorage.getItem(ENABLED_STORAGE_KEY);
    return val !== 'false'; // default is true
  } catch {
    return true;
  }
};

export const setShortcutsEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('shortcuts_toggle', { detail: enabled }));
  } catch (err) {
    console.error("Could not save shortcut enabled state", err);
  }
};

/**
 * Smart casing replacement helper:
 * - "xh" -> "xe hơi"
 * - "Xh" -> "Xe hơi"
 * - "XH" -> "XE HƠI"
 */
export const formatWithCaseMatch = (typedWord: string, expansion: string): string => {
  if (!typedWord || !expansion) return expansion;

  // ALL UPPERCASE (e.g. XH -> XE HƠI)
  if (typedWord === typedWord.toUpperCase() && typedWord.length > 1) {
    return expansion.toUpperCase();
  }

  // Capitalize first letter (Title Case: Xh -> Xe hơi)
  if (typedWord[0] === typedWord[0].toUpperCase() && typedWord.slice(1) === typedWord.slice(1).toLowerCase()) {
    return expansion.charAt(0).toUpperCase() + expansion.slice(1);
  }

  // Lowercase default
  return expansion;
};

/**
 * Check if the word right before the cursor in an HTMLTextAreaElement / HTMLInputElement
 * matches any active shortcut, and replace it automatically.
 */
export const checkAndApplyShortcut = (
  inputEl: HTMLTextAreaElement | HTMLInputElement,
  shortcuts: TextShortcut[],
  triggerChar: string = ''
): { replaced: boolean; newText: string } => {
  if (!isShortcutsEnabled()) return { replaced: false, newText: inputEl.value };
  if (!shortcuts || shortcuts.length === 0) return { replaced: false, newText: inputEl.value };

  const start = inputEl.selectionStart;
  const end = inputEl.selectionEnd;
  if (start === null || end === null || start !== end) {
    return { replaced: false, newText: inputEl.value };
  }

  const text = inputEl.value;
  const textBeforeCursor = text.substring(0, start);

  // Match letters, numbers, and Vietnamese characters at the end of textBeforeCursor
  const match = textBeforeCursor.match(/([A-Za-z0-9àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ_]+)$/);
  if (!match) return { replaced: false, newText: text };

  const typedWord = match[1];
  const wordStartPos = start - typedWord.length;

  const matched = shortcuts.find(
    s => s.enabled && s.shortcut.trim().toLowerCase() === typedWord.toLowerCase()
  );

  if (!matched) return { replaced: false, newText: text };

  const formattedExpansion = formatWithCaseMatch(typedWord, matched.expansion);
  const fullInserted = formattedExpansion + triggerChar;

  const newText = text.substring(0, wordStartPos) + fullInserted + text.substring(end);
  const newCursorPos = wordStartPos + fullInserted.length;

  inputEl.value = newText;
  inputEl.selectionStart = newCursorPos;
  inputEl.selectionEnd = newCursorPos;

  // Trigger input event to update React state listeners
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));

  return { replaced: true, newText };
};
