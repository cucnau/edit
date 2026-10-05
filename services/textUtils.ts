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

/**
 * Làm sạch rác từ điển (ký hiệu ✚, phiên âm pinyin trong ngoặc vuông, nhãn Hán Việt, placeholder {0}, v.v.)
 */
export function cleanVietphraseMeaning(val: string): string {
  if (!val) return '';
  let str = val;

  // 1. Lọc bỏ các placeholder QuickTranslator {0}, {1}...
  str = str.replace(/\{\d+\}/g, '');

  // 2. Lọc bỏ ký hiệu rác từ điển ở đầu như ✚, +, ▪, ▫, ■, □, ▲, ▼, ◆, ◇, ※, *, #, •, -
  str = str.replace(/^[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+/, '');

  // 3. Lọc bỏ Pinyin hoặc chú thích phát âm trong ngoặc vuông [] hoặc 【】 ở đầu (ví dụ [huángjiā], [kuài])
  str = str.replace(/^[\[【][^\]】]*[\]】]\s*/, '');

  // 4. Lọc bỏ nhãn loại từ điển phổ biến ở đầu (ví dụ "Hán Việt:", "Hán Việt", "danh từ:", "động từ:")
  str = str.replace(/^(Hán\s*Việt\s*:?|danh\s*từ\s*:?|động\s*từ\s*:?|tính\s*từ\s*:?|\([^\)]*\))\s*/i, '');

  // 5. Nếu có dấu chấm phẩy ; hoặc gạch chéo / (nhiều nghĩa từ điển liệt kê), chỉ lấy nghĩa đầu tiên ngắn gọn nhất
  if (str.includes(';')) {
    str = str.split(';')[0];
  }
  if (str.includes('/')) {
    str = str.split('/')[0];
  }

  // 6. Nếu có dấu gạch ngang phân cách giải thích dài (ví dụ "bách - một trăm")
  const dashIdx = str.indexOf(' - ');
  if (dashIdx > 0) {
    str = str.substring(0, dashIdx);
  }

  // 7. Lọc sạch ký tự thừa còn lại ở đầu/cuối
  str = str.replace(/^[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+/, '');
  str = str.replace(/[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+$/, '');

  return str.trim();
}

/**
 * Quét và dọn sạch triệt để các rác từ điển trong toàn bộ một câu hoặc đoạn văn bản kết quả
 */
export function cleanTextArtifacts(text: string): string {
  if (!text) return '';
  return text
    // Xóa placeholder {0}, {1}...
    .replace(/\{\d+\}/g, '')
    // Xóa ký hiệu ✚ và các dấu tương tự
    .replace(/[✚▪▫■□▲▼◆◇※]/g, '')
    // Xóa các cụm pinyin [huángjiā], [kuài]... còn sót lại trong câu
    .replace(/\[[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ\s\d,]+\]/g, '')
    // Xóa nhãn Hán Việt: đứng đơn độc
    .replace(/\bHán\s+Việt\s*:\s*/gi, '')
    // Chuẩn hóa khoảng trắng
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}
