
import { CustomTerm, VietphraseFile, VietphraseFileType } from "../types";
import { db } from "./db";
import { cleanVietphraseMeaning, cleanTextArtifacts } from "./textUtils";

export interface TrieNode {
  children: Map<string, TrieNode>;
  value?: string; // Nghĩa tiếng Việt
}

/**
 * Tự động nhận diện phân loại từ điển theo chuẩn QuickTranslator / QuickTrans 2025:
 * - Names (Tên riêng, nhân vật, địa danh): Priority 80 (Cao nhất trong các file)
 * - Danh Từ (Thuật ngữ, danh từ chuyên ngành): Priority 70
 * - Pronouns (Đại từ xưng hô, nhân xưng): Priority 60
 * - Luật Nhân (Quy tắc xưng hô, hậu tố chức vụ): Priority 50
 * - Vietphrase chung (Cụm từ thông dụng): Priority 40
 * - Hậu Từ (Phụ tố cuối từ): Priority 30
 * - Họ Người (Họ người Trung Quốc): Priority 20
 * - Lạc Việt (Từ điển từ đơn cơ bản): Priority 10 (Nạp trước, làm nền dự phòng)
 */
export const getQuickTransFileType = (fileName: string): { fileType: VietphraseFileType; priority: number; label: string; color: string } => {
  const lower = fileName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_\-\.]/g, '');
  if (lower.includes('name') || lower.includes('tenrieng') || lower.includes('nhanvat')) {
    return { fileType: 'names', priority: 80, label: 'Names (Tên riêng)', color: 'bg-purple-100 text-purple-800 border-purple-300' };
  }
  if (lower.includes('danhtu') || lower.includes('noun')) {
    return { fileType: 'danhtu', priority: 70, label: 'Danh Từ', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' };
  }
  if (lower.includes('pronoun') || lower.includes('daitu') || lower.includes('xungho')) {
    return { fileType: 'pronouns', priority: 60, label: 'Pronouns (Đại từ)', color: 'bg-blue-100 text-blue-800 border-blue-300' };
  }
  if (lower.includes('luatnhan') || lower.includes('quytac')) {
    return { fileType: 'luatnhan', priority: 50, label: 'Luật Nhân', color: 'bg-teal-100 text-teal-800 border-teal-300' };
  }
  if (lower.includes('vietphrase') || lower.includes('vp') || lower.includes('phrase')) {
    return { fileType: 'vietphrase', priority: 40, label: 'Vietphrase chung', color: 'bg-amber-100 text-amber-800 border-amber-300' };
  }
  if (lower.includes('hautu') || lower.includes('suffix')) {
    return { fileType: 'hautu', priority: 30, label: 'Hậu Từ', color: 'bg-orange-100 text-orange-800 border-orange-300' };
  }
  if (lower.includes('honguoi') || lower.includes('surname')) {
    return { fileType: 'honguoi', priority: 20, label: 'Họ Người', color: 'bg-rose-100 text-rose-800 border-rose-300' };
  }
  if (lower.includes('lacviet') || lower.includes('hanviet') || lower.includes('thieuchuu') || lower.includes('tudon') || lower.includes('tudien')) {
    return { fileType: 'lacviet', priority: 10, label: 'Lạc Việt / Hán Việt', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  }
  return { fileType: 'other', priority: 35, label: 'Khác', color: 'bg-stone-100 text-stone-800 border-stone-300' };
};

export interface LacVietLookupResult {
  found: boolean;
  meaning: string;
  charByChar?: { char: string; meaning: string }[];
}

/**
 * Từ điển Hán Việt / Lạc Việt nền tảng thông dụng (Dự phòng khi người dùng chưa nạp file LacViet.txt)
 */
const BUILTIN_HANVIET_FALLBACK: Record<string, string> = {
  '一': 'nhất - một, thứ nhất, toàn bộ',
  '二': 'nhị - hai, thứ hai',
  '三': 'tam - ba, thứ ba',
  '四': 'tứ - bốn, thứ tư',
  '五': 'ngũ - năm, thứ năm',
  '六': 'lục - sáu, thứ sáu',
  '七': 'thất - bảy, thứ bảy',
  '八': 'bát - tám, thứ tám',
  '九': 'cửu - chín, thứ chín',
  '十': 'thập - mười, đầy đủ',
  '百': 'bách - trăm, nhiều, vô số',
  '千': 'thiên - nghìn, rất nhiều',
  '万': 'vạn - vạn, muôn, vô số',
  '人': 'nhân - người, loài người, kẻ khác',
  '大': 'đại - to, lớn, rất, tôn quý',
  '小': 'tiểu - nhỏ, bé, hèn mọn',
  '中': 'trung - giữa, trong, trúng, vừa',
  '上': 'thượng - trên, bậc trên, lên, trước',
  '下': 'hạ - dưới, bậc dưới, xuống, sau',
  '天': 'thiên - trời, ngày, khí trời, tự nhiên',
  '地': 'địa - đất, mặt đất, vị trí, nơi chốn',
  '日': 'nhật - mặt trời, ngày, ban ngày',
  '月': 'nguyệt - mặt trăng, tháng',
  '年': 'niên - năm, tuổi tác',
  '时': 'thời - thời gian, thời khắc, mùa, thời thế',
  '水': 'thủy - nước, sông biển, chất lỏng',
  '火': 'hỏa - lửa, cháy, bực tức, nóng nảy',
  '山': 'sơn - núi, non',
  '风': 'phong - gió, phong thái, thói tục, tin tức',
  '云': 'vân - mây, nói rằng',
  '雨': 'vũ - mưa',
  '雪': 'tuyết - tuyết, rửa sạch',
  '道': 'đạo - đường đi, đạo lý, đạo giáo, nói',
  '理': 'lý - lẽ phải, quy luật, sửa sang, quản lý',
  '心': 'tâm - tim, lòng dạ, tâm tư, ở giữa',
  '意': 'ý - ý nghĩ, ý định, mong muốn, tình cảm',
  '情': 'tình - tình cảm, tình ý, tình hình, thực chất',
  '爱': 'ái - yêu, thương, quý mến, ưa thích',
  '恨': 'hận - căm ghét, hối tiếc, oán thù',
  '生': 'sinh - sống, sinh sản, sinh ra, còn sống, lạ',
  '死': 'tử - chết, diệt vong, bất động, đến cùng',
  '出': 'xuất - ra ngoài, xuất hiện, phát ra',
  '入': 'nhập - vào trong, thu vào, tham gia',
  '来': 'lai - đến, tới, trở lại, tương lai',
  '去': 'khứ - đi, rời bỏ, mất đi, quá khứ',
  '有': 'hữu - có, tồn tại, sở hữu',
  '无': 'vô - không có, mất, đừng',
  '不': 'bất - không, chẳng, chưa',
  '非': 'phi - không phải, trái ngược, sai trái',
  '是': 'thị - là, đúng, phải, đích thực',
  '为': 'vi/vị - làm, thành, vì, bởi vì',
  '能': 'năng - có thể, tài năng, năng lực',
  '会': 'hội - biết, gặp gỡ, tụ họp, cơ hội',
  '得': 'đắc - được, đạt được, thích hợp, phải',
  '要': 'yếu/yêu - muốn, cần, cốt yếu, quan trọng',
  '想': 'tưởng - nghĩ, nhớ, mong muốn, suy tưởng',
  '见': 'kiến - thấy, gặp, hiểu biết, ý kiến',
  '看': 'khán - nhìn, xem, coi sóc, phán đoán',
  '听': 'thính - nghe, nghe theo, tuân theo',
  '言': 'ngôn - lời nói, nói rằng, ngôn ngữ',
  '语': 'ngữ - tiếng, lời nói, ngôn ngữ',
  '说': 'thuyết - nói, giải thích, đạo lý',
  '知': 'tri - biết, hiểu, nhận thức, tri thức',
  '识': 'thức - biết, nhận biết, kiến thức',
  '明': 'minh - sáng sủa, rõ ràng, hiểu biết, ngày mai',
  '白': 'bạch - trắng, rõ ràng, uổng công, bẩm báo',
  '黑': 'hắc - đen, tối tăm, mờ ám',
  '红': 'hồng - đỏ, nổi tiếng, thuận lợi',
  '高': 'cao - cao ráo, cao quý, giỏi giang',
  '低': 'đê - thấp, hèn, cúi đầu',
  '多': 'đa - nhiều, dư thừa, hơn nữa',
  '少': 'thiểu/thiếu - ít, hiếm, tuổi trẻ',
  '长': 'trường/trưởng - dài, lâu dài, lớn lên, đứng đầu',
  '短': 'đoản - ngắn, khuyết điểm, thiếu thốn',
  '真': 'chân - thật, chân thật, đích thực',
  '假': 'giả - giả dối, mượn, nếu như',
  '正': 'chính - ngay thẳng, chính đáng, đúng lúc',
  '反': 'phản - ngược lại, trái lại, quay lại, phản bội',
  '好': 'hảo/hiếu - tốt, đẹp, thích, thân thiện',
  '坏': 'hoại - hỏng, xấu, tệ, làm hỏng',
  '强': 'cường - mạnh mẽ, kiên cường, cưỡng ép',
  '弱': 'nhược - yếu ớt, kém cỏi, non nớt',
  '神': 'thần - thần linh, tinh thần, kỳ diệu',
  '仙': 'tiên - tiên nhân, trường sinh bất tử',
  '魔': 'ma - ma quỷ, mê hoặc, ma thuật',
  '剑': 'kiếm - thanh kiếm, gươm',
  '刀': 'đao - con dao, đao, vũ khí chém',
  '法': 'pháp - pháp luật, phương pháp, phép thuật',
  '术': 'thuật - kỹ thuật, nghệ thuật, phương pháp',
  '气': 'khí - không khí, hơi thở, khí chất, giận dữ',
  '力': 'lực - sức lực, năng lực, cố gắng',
  '功': 'công - công lao, công phu, thành tựu',
  '战': 'chiến - đánh nhau, chiến tranh, run sợ',
  '斗': 'đấu - tranh đấu, đọ sức, chiến đấu',
  '武': 'võ - võ thuật, quân sự, mạnh bạo',
  '文': 'văn - văn chương, văn hóa, chữ viết, dịu dàng',
  '君': 'quân - vua, chúa, người quân tử, chàng',
  '臣': 'thần - bề tôi, quan lại, tôi tớ',
  '主': 'chủ - chủ nhân, đứng đầu, chủ yếu',
  '客': 'khách - người khách, xa lạ, khách quan',
  '友': 'hữu - bạn bè, thân thiết, giúp đỡ',
  '敌': 'địch - kẻ địch, đối thủ, chống lại',
  '家': 'gia - nhà, gia đình, môn phái, chuyên gia',
  '国': 'quốc - nước, quốc gia, xứ sở',
  '世': 'thế - đời, thế giới, thời đại, thế gian',
  '界': 'giới - ranh giới, phạm vi, giới hạn',
  '门': 'môn - cửa, môn phái, ngõ vào',
  '派': 'phái - trường phái, sai khiến, cử đi',
  '宗': 'tông - tổ tiên, tôn sùng, tông phái',
  '身': 'thân - thân thể, mình, bản thân',
  '手': 'thủ - bàn tay, tay, tự tay, người làm việc',
  '足': 'túc - bàn chân, chân, đầy đủ, thỏa mãn',
  '目': 'mục - mắt, nhìn, mục lục, hạng mục',
  '口': 'khẩu - miệng, cửa ngõ, lời nói, nhân khẩu',
  '头': 'đầu - cái đầu, đứng đầu, trước tiên',
  '如': 'như - giống như, nếu như, theo như',
  '何': 'hà - sao, cái gì, thế nào',
  '其': 'kỳ - ấy, đó, nó, của nó',
  '此': 'thử - đây, này, việc này',
  '彼': 'bỉ - kia, đó, người kia',
  '自': 'tự - tự mình, từ đâu đến, đương nhiên',
  '己': 'kỷ - bản thân, tự mình',
  '他': 'tha - hắn, anh ta, người khác',
  '她': 'nàng - cô ấy, nàng, chị ấy',
  '你': 'nhĩ - bạn, anh, ngươi, mày',
  '我': 'ngã - tôi, ta, bản thân mình',
  '们': 'môn - chúng, bọn, các (hậu tố số nhiều)',
  '之': 'chi - của, này, đi đến, nó (trợ từ)',
  '的': 'đích - của, đích (trợ từ)',
  '着': 'trước - đang, tiếp diễn (trợ từ)',
  '了': 'liễu - rồi, xong (trợ từ)',
  '乎': 'hô - ư, ru, chăng (trợ từ nghi vấn)',
  '者': 'giả - người, kẻ, cái, việc',
  '也': 'dã - cũng, lại, vậy (trợ từ khẳng định)'
};

export interface OmittedParticleInfo {
  char: string;
  pinyin: string;
  hanViet: string;
  note: string;
  category: 'ket_cau' | 'thoi_thai' | 'ngu_khi';
}

export const DEFAULT_OMITTED_PARTICLES: OmittedParticleInfo[] = [
  // 1. Nhóm trợ từ kết cấu & định ngữ / trạng ngữ / bổ ngữ (Cực kỳ phổ biến, xuất hiện nhiều nhất)
  { char: '的', pinyin: 'de', hanViet: 'đích', note: 'Trợ từ định ngữ số 1 tiếng Trung: "xinh đẹp đích", "hắn đích", "tốt đích" -> ẩn để câu không bị dính chữ "đích"', category: 'ket_cau' },
  { char: '地', pinyin: 'de', hanViet: 'địa', note: 'Trợ từ nối trạng từ: nhanh chóng "địa" chạy -> nhanh chóng chạy', category: 'ket_cau' },
  { char: '得', pinyin: 'de', hanViet: 'đắc', note: 'Nối bổ ngữ: chạy "đắc" nhanh, đau "đắc" khóc -> chạy nhanh, đau đến khóc', category: 'ket_cau' },
  { char: '之', pinyin: 'zhi', hanViet: 'chi', note: 'Trợ từ cổ tương đương "đích" trong văn ngôn, tiên hiệp: hắn "chi" tử, thiên hạ "chi" đại', category: 'ket_cau' },
  
  // 2. Nhóm trợ từ thời thái & tiếp diễn
  { char: '了', pinyin: 'le', hanViet: 'liễu', note: 'Biểu thị hoàn thành: đi "liễu", chết "liễu" -> đi, chết', category: 'thoi_thai' },
  { char: '着', pinyin: 'zhe', hanViet: 'trứ/trước', note: 'Biểu thị tiếp diễn: nhìn "trứ", cười "trứ" -> nhìn, cười', category: 'thoi_thai' },

  // 3. Nhóm trợ từ ngữ khí cuối câu (từ đệm âm Hán Việt thô ở đuôi câu)
  { char: '啦', pinyin: 'la', hanViet: 'lạp', note: 'Ngữ khí cảm thán: tới "lạp", xong "lạp" -> tới rồi, xong rồi', category: 'ngu_khi' },
  { char: '呢', pinyin: 'ne', hanViet: 'ni', note: 'Ngữ khí cuối câu hỏi/tiếp diễn: ở đâu "ni", sao vậy "ni"', category: 'ngu_khi' },
  { char: '吧', pinyin: 'ba', hanViet: 'ba', note: 'Ngữ khí đề nghị: đi "ba", được "ba"', category: 'ngu_khi' },
  { char: '呀', pinyin: 'ya', hanViet: 'nha', note: 'Cảm thán cuối câu: đẹp "nha", đúng "nha"', category: 'ngu_khi' },
  { char: '啊', pinyin: 'a', hanViet: 'a', note: 'Cảm thán cuối câu: đi "a", tốt "a"', category: 'ngu_khi' },
  { char: '嘛', pinyin: 'ma', hanViet: 'ma', note: 'Ngữ khí hiển nhiên: vốn thế "ma"', category: 'ngu_khi' },
  { char: '喽', pinyin: 'lou', hanViet: 'lâu', note: 'Ngữ khí: xong "lâu", đi "lâu"', category: 'ngu_khi' },
  { char: '啰', pinyin: 'luo', hanViet: 'la', note: 'Ngữ khí: được "la", đi "la"', category: 'ngu_khi' },
  { char: '罗', pinyin: 'luo', hanViet: 'la', note: 'Ngữ khí (dạng khác của 啰): xong "la"', category: 'ngu_khi' },
  { char: '咧', pinyin: 'lie', hanViet: 'liệt', note: 'Ngữ khí: cười "liệt", nói "liệt"', category: 'ngu_khi' },
  { char: '哇', pinyin: 'wa', hanViet: 'oa', note: 'Cảm thán: "oa"', category: 'ngu_khi' },

  // 4. Nhóm hư từ ngữ khí cổ phong / kiếm hiệp / huyền huyễn
  { char: '矣', pinyin: 'yi', hanViet: 'hĩ', note: 'Hư từ ngữ khí cổ khẳng định: chết "hĩ", xong "hĩ"', category: 'ngu_khi' },
  { char: '哉', pinyin: 'zai', hanViet: 'tai', note: 'Cảm thán cổ: nguy "tai", thương "tai"', category: 'ngu_khi' },
  { char: '乎', pinyin: 'hu', hanViet: 'hô', note: 'Nghi vấn cổ: phải chăng "hô"', category: 'ngu_khi' },
  { char: '兮', pinyin: 'xi', hanViet: 'hề', note: 'Hư từ ngâm vịnh cổ: hồn "hề" quy lai', category: 'ngu_khi' },
  { char: '耶', pinyin: 'ye', hanViet: 'da', note: 'Nghi vấn cổ: thật "da"', category: 'ngu_khi' },
  { char: '耳', pinyin: 'er', hanViet: 'nhĩ', note: 'Hư từ cuối câu biểu thị "mà thôi": thế "nhĩ"', category: 'ngu_khi' },
  { char: '焉', pinyin: 'yan', hanViet: 'yên', note: 'Hư từ cuối câu cổ phong: biết sao "yên"', category: 'ngu_khi' },
  { char: '欤', pinyin: 'yu', hanViet: 'dư', note: 'Nghi vấn cổ phong: vậy "dư"', category: 'ngu_khi' }
];

export const DEFAULT_OMITTED_CHARS = DEFAULT_OMITTED_PARTICLES.map(p => p.char);

class VietphraseEngine {
  private dictionary: Map<string, string>;
  private lacVietDictionary: Map<string, string>;
  private activeCustomMap: Map<string, string> = new Map();
  private maxKeyLength: number;
  private isLoaded: boolean = false;
  private listeners: Set<() => void> = new Set();
  private files: VietphraseFile[] = [];

  private omittedParticles: Set<string> = new Set(DEFAULT_OMITTED_CHARS);
  private enableParticleOmission: boolean = true;

  constructor() {
    this.dictionary = new Map();
    this.lacVietDictionary = new Map();
    this.maxKeyLength = 0;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedOmitted = localStorage.getItem('app_omitted_particles');
        if (savedOmitted) {
          const parsed = JSON.parse(savedOmitted);
          if (Array.isArray(parsed)) {
            // Tự động gộp trọn bộ danh sách chuẩn (đặc biệt là 的, 之...) cùng bất kỳ từ nào người dùng thêm
            const merged = new Set([...DEFAULT_OMITTED_CHARS, ...parsed]);
            this.omittedParticles = merged;
            localStorage.setItem('app_omitted_particles', JSON.stringify(Array.from(merged)));
          } else {
            this.omittedParticles = new Set(DEFAULT_OMITTED_CHARS);
            localStorage.setItem('app_omitted_particles', JSON.stringify(DEFAULT_OMITTED_CHARS));
          }
        } else {
          this.omittedParticles = new Set(DEFAULT_OMITTED_CHARS);
          localStorage.setItem('app_omitted_particles', JSON.stringify(DEFAULT_OMITTED_CHARS));
        }
        const savedEnabled = localStorage.getItem('app_omit_particles_enabled');
        if (savedEnabled !== null) {
          this.enableParticleOmission = savedEnabled === 'true';
        }
      }
    } catch (e) {
      this.omittedParticles = new Set(DEFAULT_OMITTED_CHARS);
    }
  }

  // Quản lý danh sách trợ từ ngữ pháp đơn lẻ cần ẩn
  getOmittedParticles(): string[] {
    return Array.from(this.omittedParticles);
  }

  getParticleInfo(char: string): OmittedParticleInfo | undefined {
    return DEFAULT_OMITTED_PARTICLES.find(p => p.char === char);
  }

  resetToDefaultParticles(): void {
    this.omittedParticles = new Set(DEFAULT_OMITTED_CHARS);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('app_omitted_particles', JSON.stringify(DEFAULT_OMITTED_CHARS));
      }
    } catch (e) {}
    this.notify();
  }

  isParticleOmissionEnabled(): boolean {
    return this.enableParticleOmission;
  }

  setParticleOmissionEnabled(enabled: boolean): void {
    this.enableParticleOmission = enabled;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('app_omit_particles_enabled', enabled ? 'true' : 'false');
      }
    } catch (e) {}
    this.notify();
  }

  setOmittedParticles(particles: string[]): void {
    this.omittedParticles = new Set(particles.map(p => p.trim()).filter(Boolean));
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('app_omitted_particles', JSON.stringify(Array.from(this.omittedParticles)));
      }
    } catch (e) {}
    this.notify();
  }

  addOmittedParticle(char: string): void {
    const clean = char.trim();
    if (!clean) return;
    this.omittedParticles.add(clean);
    this.setOmittedParticles(Array.from(this.omittedParticles));
  }

  removeOmittedParticle(char: string): void {
    const clean = char.trim();
    if (!clean) return;
    this.omittedParticles.delete(clean);
    this.setOmittedParticles(Array.from(this.omittedParticles));
  }

  isOmittedParticle(char: string): boolean {
    if (!this.enableParticleOmission) return false;
    return this.omittedParticles.has(char);
  }

  // Đăng ký nhận sự kiện thay đổi dữ liệu từ điển
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify() {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (e) {
        console.error("Error invoking Vietphrase listener", e);
      }
    });
  }

  // Cập nhật Custom Map toàn cục để luôn ghi nhớ
  setCustomMap(map: Map<string, string> | CustomTerm[]) {
    if (map instanceof Map) {
      this.activeCustomMap = new Map(map);
    } else {
      this.activeCustomMap = new Map();
      for (const t of map) {
        if (t.term && t.meaning) {
          this.activeCustomMap.set(t.term.trim(), t.meaning.trim());
        }
      }
    }
  }

  getCustomMap(): Map<string, string> {
    return this.activeCustomMap;
  }

  // Thêm hoặc ghi đè một từ / nhân vật tức thì vào engine để đảm bảo 100% ăn ngay
  addCustomTerm(term: string, meaning: string): void {
    const cleanTerm = term.trim();
    const cleanMeaning = meaning.trim();
    if (!cleanTerm || !cleanMeaning) return;
    this.activeCustomMap.set(cleanTerm, cleanMeaning);
    this.dictionary.set(cleanTerm, cleanMeaning);
    if (cleanTerm.length > this.maxKeyLength) {
      this.maxKeyLength = cleanTerm.length;
    }
    this.notify();
  }

  // Xóa từ hoặc nhân vật khỏi engine
  removeCustomTerm(term: string): void {
    const cleanTerm = term.trim();
    if (!cleanTerm) return;
    this.activeCustomMap.delete(cleanTerm);
    this.rebuild();
    this.notify();
  }

  // Khởi tạo: Load từ DB nếu có
  async init() {
      if (this.isLoaded) return;
      
      const savedFiles = await db.getVietphraseFiles();
      if (savedFiles && Array.isArray(savedFiles)) {
          this.files = savedFiles.map(f => {
            const meta = getQuickTransFileType(f.name);
            return {
              ...f,
              fileType: f.fileType || meta.fileType,
              priority: f.priority !== undefined ? f.priority : meta.priority
            };
          });
          this.rebuild();
          console.log(`Đã khôi phục ${this.files.length} file Vietphrase từ DB`);
      } else {
          // Khôi phục từ dữ liệu đơn lẻ cũ (nếu có) để bảo mật tương thích ngược
          const savedContent = await db.getVietphrase();
          if (savedContent && typeof savedContent === 'string') {
              const defaultFile: VietphraseFile = {
                id: "vp_default",
                name: "Vietphrase_Goc.txt",
                content: savedContent,
                enabled: true,
                addedAt: Date.now(),
                fileType: 'vietphrase',
                priority: 40
              };
              this.files = [defaultFile];
              await db.saveVietphraseFiles(this.files);
              this.rebuild();
              console.log("Đã di chuyển dữ liệu Vietphrase cũ sang định dạng đa tệp");
          }
      }
      this.isLoaded = true;
      this.notify();
  }

  // Lấy danh sách tệp tin hiện tại
  getFiles(): VietphraseFile[] {
    return this.files;
  }

  // Lấy số lượng từ hiện tại tổng cộng
  getSize(): number {
    return this.dictionary.size;
  }

  // Lấy số lượng từ trong từ điển Lạc Việt
  getLacVietSize(): number {
    return this.lacVietDictionary.size;
  }

  // Tra cứu từ điển Lạc Việt (Hỗ trợ tra cả cụm từ hoặc phân tích chi tiết từng chữ)
  lookupLacViet(text: string): LacVietLookupResult {
    const clean = text.trim();
    if (!clean) return { found: false, meaning: '' };

    // 1. Kiểm tra chính xác cả cụm từ trong kho Lạc Việt
    if (this.lacVietDictionary.has(clean)) {
      return {
        found: true,
        meaning: this.lacVietDictionary.get(clean) || ''
      };
    }

    // 2. Tra cứu từng chữ Hán nếu cụm từ dài hoặc không có cả cụm
    const chars = Array.from(clean);
    const charByChar: { char: string; meaning: string }[] = [];
    let hasAnyMeaning = false;

    for (const ch of chars) {
      // Chỉ tra cứu các ký tự Hán tự
      if (/[\u4e00-\u9fff]/.test(ch)) {
        if (this.lacVietDictionary.has(ch)) {
          charByChar.push({ char: ch, meaning: this.lacVietDictionary.get(ch)! });
          hasAnyMeaning = true;
        } else if (this.dictionary.has(ch)) {
          charByChar.push({ char: ch, meaning: this.dictionary.get(ch)! });
          hasAnyMeaning = true;
        } else {
          charByChar.push({ char: ch, meaning: 'Chưa có trong từ điển Lạc Việt' });
        }
      }
    }

    if (hasAnyMeaning && charByChar.length > 0) {
      const summaryMeaning = charByChar
        .filter(c => c.meaning !== 'Chưa có trong từ điển Lạc Việt')
        .map(c => `${c.char}: ${c.meaning.split(/[\r\n]|\\[nrt]/)[0].split('/')[0].trim()}`)
        .join(' | ');

      return {
        found: true,
        meaning: summaryMeaning,
        charByChar
      };
    }

    return {
      found: false,
      meaning: ''
    };
  }

  // Rebuild từ điển từ danh sách các tệp tin được kích hoạt theo đúng thứ tự ưu tiên QuickTrans
  rebuild() {
    this.dictionary.clear();
    this.lacVietDictionary.clear();
    this.maxKeyLength = 0;

    // Nạp trước bộ từ điển Hán Việt nền tảng vào LacVietDictionary
    for (const [key, val] of Object.entries(BUILTIN_HANVIET_FALLBACK)) {
      this.lacVietDictionary.set(key, val);
    }

    // Sắp xếp các file theo thứ tự độ ưu tiên từ THẤP lên CAO:
    // File có priority thấp (Lạc Việt) nạp trước làm nền tảng từ đơn
    // File có priority cao hơn (Vietphrase, Pronouns, Danh Từ, Names) nạp sau để ghi đè chuẩn xác
    const sortedFiles = [...this.files]
      .filter(f => f.enabled)
      .sort((a, b) => {
        const pA = a.priority !== undefined ? a.priority : getQuickTransFileType(a.name).priority;
        const pB = b.priority !== undefined ? b.priority : getQuickTransFileType(b.name).priority;
        if (pA !== pB) {
          return pA - pB;
        }
        return a.addedAt - b.addedAt;
      });

    for (const file of sortedFiles) {
      const isLacViet = file.fileType === 'lacviet' || file.name.toLowerCase().includes('lacviet') || file.name.toLowerCase().includes('hanviet') || file.name.toLowerCase().includes('thieuchuu');
      const lines = file.content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

        let key = "";
        let value = "";
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          key = trimmed.substring(0, eqIdx).trim();
          value = trimmed.substring(eqIdx + 1).trim();
        } else {
          // Hỗ trợ định dạng tách bằng phím Tab (tab-separated)
          const tabParts = trimmed.split(/\t+/);
          if (tabParts.length >= 2) {
            key = tabParts[0].trim();
            value = tabParts[1].trim();
          }
        }

        if (key && value) {
          // Lọc sạch toàn bộ rác từ điển (ký hiệu ✚, phiên âm [pinyin], nhãn Hán Việt, placeholder {0}, v.v.)
          const cleanVal = cleanVietphraseMeaning(value);

          if (isLacViet) {
            // Nạp bản làm sạch ký hiệu ✚ vào từ điển Lạc Việt riêng để tra cứu
            this.lacVietDictionary.set(key, value.replace(/^[✚\+\*\#\•\-\▪\▫\■\□\▲\▼\◆\◇\※\s]+/, '').replace(/[✚➕＋]/g, ''));
            // Đồng thời đưa một bản rút gọn vào dictionary dịch nếu chưa có để làm từ đơn dự phòng
            if (!this.dictionary.has(key) && cleanVal) {
              this.dictionary.set(key, cleanVal);
            }
          } else {
            // Các file khác (Names, Danh Từ, Pronouns, Vietphrase...): nạp đè theo chuẩn QuickTrans
            if (cleanVal) {
              this.dictionary.set(key, cleanVal);
            }
          }

          if (key.length > this.maxKeyLength) {
            this.maxKeyLength = key.length;
          }
        }
      }
    }
    console.log(`Đã nạp ${this.dictionary.size} từ Vietphrase & ${this.lacVietDictionary.size} từ Lạc Việt từ ${sortedFiles.length} file hoạt động (Thứ tự ưu tiên phân tầng QuickTrans). Max length: ${this.maxKeyLength}`);
    this.notify();
  }

  // Thêm một tệp mới với tự động nhận diện phân loại QuickTrans
  addFile(name: string, content: string, fileType?: VietphraseFileType, priority?: number): VietphraseFile {
    const meta = getQuickTransFileType(name);
    const newFile: VietphraseFile = {
      id: "vp_" + Date.now() + "_" + Math.random().toString(36).substring(2, 5),
      name,
      content,
      enabled: true,
      addedAt: Date.now(),
      fileType: fileType || meta.fileType,
      priority: priority !== undefined ? priority : meta.priority
    };
    this.files.push(newFile);
    db.saveVietphraseFiles(this.files).catch(console.error);
    this.rebuild();
    return newFile;
  }

  // Cập nhật thuộc tính của tệp (loại file, độ ưu tiên, trạng thái)
  updateFile(id: string, updates: Partial<VietphraseFile>) {
    this.files = this.files.map(f => f.id === id ? { ...f, ...updates } : f);
    db.saveVietphraseFiles(this.files).catch(console.error);
    this.rebuild();
  }

  // Xóa một tệp tin
  removeFile(id: string) {
    this.files = this.files.filter(f => f.id !== id);
    db.saveVietphraseFiles(this.files).catch(console.error);
    this.rebuild();
  }

  // Bật/tắt trạng thái sử dụng của tệp tin
  toggleFile(id: string) {
    this.files = this.files.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f);
    db.saveVietphraseFiles(this.files).catch(console.error);
    this.rebuild();
  }

  // Nạp dữ liệu từ nội dung file text (Tương thích ngược với các hàm cũ gọi loadDictionary)
  loadDictionary(content: string, save: boolean = true) {
    const fileName = "Vietphrase_Uploaded_" + new Date().toLocaleDateString('vi-VN').replace(/\//g, '-') + "_" + Math.random().toString(36).substring(2, 5) + ".txt";
    this.addFile(fileName, content);
    return this.dictionary.size;
  }

  // Thuật toán FMM dịch bằng từ điển nền tảng Vietphrase cho các đoạn văn bản
  private translateWithFMM(text: string): string {
    if (!text) return "";
    let result = "";
    let i = 0;
    const n = text.length;

    while (i < n) {
      let matched = false;
      const limit = Math.min(n, i + this.maxKeyLength);

      for (let j = limit; j > i; j--) {
        const sub = text.substring(i, j);

        if (j - i > 1) {
          // Từ ghép (2 ký tự trở lên): tra cứu từ điển bình thường (ưu tiên từ dài)
          if (this.dictionary.has(sub)) {
            let meaning = this.dictionary.get(sub) || sub;
            // Lọc sạch toàn bộ rác từ điển (✚, [pinyin], Hán Việt, {0}...)
            meaning = cleanVietphraseMeaning(meaning);
            if (meaning) {
              result += " " + meaning + " ";
            }
            i = j;
            matched = true;
            break;
          }
        } else {
          // Từ đơn lẻ (1 ký tự):
          // Kiểm tra xem có phải trợ từ ngữ pháp kết cấu / ngữ khí cần ẩn (như 地, 了) khi đứng đơn lẻ hay không
          if (this.isOmittedParticle(sub)) {
            i = j; // Lược bỏ, không sinh ra âm Hán Việt thô vào chuỗi Vietphrase
            matched = true;
            break;
          }

          if (this.dictionary.has(sub)) {
            let meaning = this.dictionary.get(sub) || sub;
            // Lọc sạch toàn bộ rác từ điển (✚, [pinyin], Hán Việt, {0}...)
            meaning = cleanVietphraseMeaning(meaning);
            if (meaning) {
              result += " " + meaning + " ";
            }
            i = j;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        result += text[i];
        i++;
      }
    }
    return result;
  }

  // Thuật toán dịch tối ưu: Đảm bảo 100% Custom Terms & Nhân vật ghi đè tuyệt đối lên Vietphrase
  translate(text: string, customTerms: CustomTerm[] | Map<string, string> = []): string {
    if (!text) return "";

    // 1. Chuẩn bị Custom Map kết hợp cả activeCustomMap nội bộ và danh sách truyền vào
    const combinedCustomMap = new Map<string, string>(this.activeCustomMap);

    if (customTerms instanceof Map) {
      customTerms.forEach((val, key) => {
        if (key && val) combinedCustomMap.set(key.trim(), val.trim());
      });
    } else if (Array.isArray(customTerms)) {
      for (const t of customTerms) {
        if (t.term && t.meaning) {
          combinedCustomMap.set(t.term.trim(), t.meaning.trim());
        }
      }
    }

    if (this.dictionary.size === 0 && combinedCustomMap.size === 0) return text;

    // Nếu không có custom terms nào, dịch toàn bộ bằng Vietphrase FMM
    if (combinedCustomMap.size === 0) {
      return this.translateWithFMM(text)
        .replace(/\{\d+\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // 2. Tìm tất cả vị trí xuất hiện của Custom Terms (Ưu tiên từ dài hơn trước)
    const sortedCustomKeys = Array.from(combinedCustomMap.keys())
      .filter(k => k && k.trim().length > 0)
      .map(k => k.trim())
      .sort((a, b) => b.length - a.length);

    const n = text.length;
    const occupied = new Array(n).fill(false);
    interface MatchRange {
      start: number;
      end: number;
      meaning: string;
    }
    const matches: MatchRange[] = [];

    for (const key of sortedCustomKeys) {
      const keyLen = key.length;
      let startIdx = 0;
      while ((startIdx = text.indexOf(key, startIdx)) !== -1) {
        let isOccupied = false;
        for (let k = startIdx; k < startIdx + keyLen; k++) {
          if (occupied[k]) {
            isOccupied = true;
            break;
          }
        }

        if (!isOccupied) {
          for (let k = startIdx; k < startIdx + keyLen; k++) {
            occupied[k] = true;
          }
          matches.push({
            start: startIdx,
            end: startIdx + keyLen,
            meaning: combinedCustomMap.get(key)!
          });
        }
        startIdx += keyLen;
      }
    }

    // Sắp xếp các đoạn khớp Custom theo thứ tự xuất hiện từ trái qua phải
    matches.sort((a, b) => a.start - b.start);

    // 3. Ghép kết quả: Giữa các Custom Terms được dịch bằng Vietphrase, Custom Terms luôn được giữ nguyên tuyệt đối
    let result = "";
    let cur = 0;

    for (const m of matches) {
      if (m.start > cur) {
        const gap = text.substring(cur, m.start);
        result += " " + this.translateWithFMM(gap) + " ";
      }
      const cleanCustomVal = cleanVietphraseMeaning(m.meaning || "");
      if (cleanCustomVal) {
        result += " " + cleanCustomVal + " ";
      }
      cur = m.end;
    }

    if (cur < n) {
      const remaining = text.substring(cur, n);
      result += " " + this.translateWithFMM(remaining) + " ";
    }

    // Chuẩn hóa và quét dọn triệt để toàn bộ rác từ điển (✚, [pinyin], Hán Việt, {0}...)
    return cleanTextArtifacts(result);
  }
}

export const vietphraseEngine = new VietphraseEngine();
