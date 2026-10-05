/**
 * Tiện ích xử lý văn bản tiếng Việt & dịch thuật
 */

/**
 * Tự động chuyển đổi tất cả dấu ngoặc kép thẳng ("...") sang dấu ngoặc kép cong thông minh (“...”)
 */
export function convertToSmartQuotes(text: string): string {
  if (!text) return text;
  
  let result = '';
  let openQuote = true;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const prevChar = i > 0 ? text[i - 1] : '';
      const nextChar = i < text.length - 1 ? text[i + 1] : '';
      
      // Đầu câu hoặc sau khoảng trắng / dấu mở ngoặc / xuống dòng / gạch ngang -> Dấu mở “
      if (i === 0 || /[\s\(\[\{<«\n\r\t—–\-]/.test(prevChar)) {
        result += '“';
        openQuote = false;
      }
      // Cuối câu hoặc trước khoảng trắng / dấu đóng ngoặc / dấu câu / xuống dòng / gạch ngang -> Dấu đóng ”
      else if (i === text.length - 1 || /[\s\)\]\}>»\n\r\t.,!?;:—–\-]/.test(nextChar)) {
        result += '”';
        openQuote = true;
      }
      // Các trường hợp khác
      else {
        if (!openQuote) {
          result += '”';
          openQuote = true;
        } else {
          result += '“';
          openQuote = false;
        }
      }
    } else {
      result += char;
    }
  }
  return result;
}
