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
 * Làm sạch rác từ điển (ký hiệu ✚, phiên âm pinyin trong ngoặc vuông, nhãn Hán Việt, placeholder {0}, chú thích ngữ pháp, escape \n\t, v.v.)
 */
export function cleanVietphraseMeaning(val: string): string {
  if (!val) return '';
  let str = val;

  // 1. Tách và lấy phần đầu trước các ký tự xuống dòng / tab (cả dạng escape "\\n", "\\t", "\\r" lẫn ký tự thật \n, \r, \t)
  // Vì trong từ điển Hán Việt / Lạc Việt, sau \n\t thường là số thứ tự định nghĩa 1. ..., 2. ...
  str = str.split(/[\r\n]|\\[nrt]/)[0].trim();

  // 2. Lọc bỏ các placeholder QuickTranslator {0}, {1}...
  str = str.replace(/\{\d+\}/g, '');

  // 3. Lọc bỏ ký hiệu rác từ điển ở đầu như ✚, +, ▪, ▫, ■, □, ▲, ▼, ◆, ◇, ※, *, #, •, -
  str = str.replace(/^[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+/, '');

  // 4. Lọc bỏ Pinyin hoặc chú thích phát âm trong ngoặc vuông [] hoặc 【】 ở đầu (ví dụ [huángjiā], [kuài])
  str = str.replace(/^[\[【][^\]】]*[\]】]\s*/, '');

  // 5. Lọc bỏ nhãn loại từ điển phổ biến ở đầu (ví dụ "Hán Việt:", "Hán Việt", "danh từ:", "động từ:")
  str = str.replace(/^(Hán\s*Việt\s*:?|danh\s*từ\s*:?|động\s*từ\s*:?|tính\s*từ\s*:?)\s*/i, '');

  // 6. Lọc bỏ các chú thích trong ngoặc đơn dạng (định ngữ và từ trung tâm...), (danh từ), (động từ)
  str = str.replace(/\([^\)]*\)/g, '').trim();

  // 7. Lọc bỏ số thứ tự ở đầu dạng 1., 2. ...
  str = str.replace(/^\d+\.\s*/, '').trim();

  // 8. Nếu có dấu chấm phẩy ; hoặc gạch chéo / hoặc dấu phẩy , (nhiều âm đọc / nghĩa liệt kê như TRƯỚC, CHIÊU), chỉ lấy nghĩa đầu tiên ngắn gọn nhất
  if (str.includes(';')) {
    str = str.split(';')[0];
  }
  if (str.includes('/')) {
    str = str.split('/')[0];
  }
  if (str.includes(',')) {
    str = str.split(',')[0];
  }

  // 9. Nếu có dấu gạch ngang phân cách giải thích dài (ví dụ "bách - một trăm")
  const dashIdx = str.indexOf(' - ');
  if (dashIdx > 0) {
    str = str.substring(0, dashIdx);
  }

  // 10. Lọc sạch ký tự thừa còn lại ở đầu/cuối
  str = str.replace(/^[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+/, '');
  str = str.replace(/[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+$/, '').trim();

  // 11. Chuyển đổi các từ Hán Việt viết hoa toàn bộ (như ĐÍCH -> đích, TRƯỚC -> trước, THĂNG -> thăng)
  if (str.length >= 2 && str === str.toUpperCase() && /[A-ZÀ-Ỹ]/.test(str)) {
    str = str.toLowerCase();
  }

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
    // Xóa các chuỗi escape rác từ điển: \n\t1., \n\t, \r\n, \t...
    .replace(/\\n\\t\d*\.?\s*/g, ' ')
    .replace(/\\[nrt]\d*\.?\s*/g, ' ')
    // Xóa các chú thích ngữ pháp trong ngoặc đơn dạng (định ngữ và từ trung tâm có quan hệ tu sức)
    .replace(/\([^\)]*(?:định\s*ngữ|trung\s*tâm|tu\s*sức|từ\s*loại|ngữ\s*pháp|danh\s*từ|động\s*từ|tính\s*từ|trợ\s*từ)[^\)]*\)/gi, '')
    // Xóa số thứ tự và chú thích từ điển dạng "1. nước cờ", "2. kế sách"
    .replace(/\b\d+\.\s*[^\s,。，;]+(?:\s*,\s*|\s*;\s*|\s+)/g, '')
    // Xóa các cụm pinyin [huángjiā], [kuài]... còn sót lại trong câu
    .replace(/\[[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ\s\d,]+\]/g, '')
    // Xóa nhãn Hán Việt: đứng đơn độc
    .replace(/\bHán\s+Việt\s*:\s*/gi, '')
    // Chuyển đổi các từ viết HOA Hán Việt thông dụng nếu bị lọt vào câu
    .replace(/\bĐÍCH\b/g, 'đích')
    .replace(/\bTRƯỚC\b/g, 'trước')
    .replace(/\bCHIÊU\b/g, 'chiêu')
    // Chuẩn hóa khoảng trắng
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

/**
 * Định dạng nội dung tra cứu từ điển / Lạc Việt:
 * Chuyển các ký tự escape '\n', '\t' thành xuống dòng thực sự,
 * tự động tách các mục định nghĩa 1., 2., 3... thành từng dòng rõ ràng,
 * thụt lề đẹp mắt để hiển thị dạng danh sách thay vì dính liền một dòng.
 */
export function formatDictionaryDefinition(raw: string): string {
  if (!raw) return '';

  // 1. Chuyển chuỗi escape \r, \n, \t thành ký tự xuống dòng / tab thực
  let text = raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');

  // 2. Xuống dòng trước các dấu cộng hoặc phiên âm đa âm tiếp theo nếu dính liền
  text = text.replace(/([^\n])\s*([✚➕＋+]\s*\[)/g, '$1\n$2');
  text = text.replace(/([^\n])\s*(\[[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ\s\d,]+\]\s*Hán\s+Việt)/gi, '$1\n$2');

  // 3. Ẩn hoàn toàn dấu cộng (✚, ➕, ＋) và các ký hiệu rác tương tự ở đầu dòng/trước phiên âm
  text = text.replace(/[✚➕＋]/g, '');
  text = text.replace(/^[+*#•\-▪▫■□▲▼◆◇※]\s*/gm, '');

  // 4. Tự động xuống dòng trước các mục đánh số 1., 2., 3. hoặc a), b)... nếu đang viết liền
  text = text.replace(/([^\n])\s*(\b[0-9]+[.)]\s+)/g, '$1\n$2');

  // 5. Chuẩn hóa thụt dòng cho các mục sau \n\t hoặc \n\s*
  const lines: string[] = [];
  const rawLines = text.split('\n');

  for (let idx = 0; idx < rawLines.length; idx++) {
    const trimmed = rawLines[idx].trim();
    if (!trimmed) continue;

    // Nếu là khối phát âm mới (đa âm, ví dụ: [yìng] Hán Việt: ỨNG), thêm khoảng cách dòng cho thoáng
    if (idx > 0 && /^\[.*?\]\s*Hán\s+Việt/i.test(trimmed)) {
      lines.push('');
      lines.push(trimmed);
    } else if (idx > 0 && /^[0-9]+[.)]/.test(trimmed)) {
      // Nếu là dòng đánh số thứ tự từ dòng thứ 2 trở đi, thụt lề nhẹ 2 khoảng trắng
      lines.push('  ' + trimmed);
    } else {
      lines.push(trimmed);
    }
  }

  return lines.join('\n');
}

/**
 * Trích xuất nghĩa ngắn gọn, sạch sẽ từ mục tra cứu từ điển để điền vào ô Từ Vựng
 */
export function cleanMeaningForVocab(raw: string): string {
  if (!raw) return '';
  const text = raw
    .replace(/[✚➕＋]/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';

  // Ưu tiên trích phần âm Hán Việt nếu có (vd: "Hán Việt: ĐIỆP" -> "Điệp")
  const hvMatch = firstLine.match(/Hán Việt:\s*([^,\n\t;]+)/i);
  if (hvMatch && hvMatch[1]) {
    const val = hvMatch[1].trim();
    return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
  }

  // Hoặc lấy nghĩa đầu tiên ở mục 1. nếu có
  const numberedMatch = text.match(/1\.\s*([^;\n\t]+)/);
  if (numberedMatch && numberedMatch[1]) {
    return numberedMatch[1].trim();
  }

  let cleaned = firstLine.replace(/^\[.*?\]\s*/, '');
  cleaned = cleaned.split('/')[0].split(' - ')[0].split(';')[0].trim();
  return cleaned;
}
