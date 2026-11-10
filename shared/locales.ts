import type {Language} from './language';
import {englishMessages} from './locales/en';
import {traditionalMessages} from './locales/zh-TW';
import {vietnameseMessages} from './locales/vi';
export type Translate = (chinese:string,english?:string)=>string;
export const interfaceMessages={en:englishMessages,'zh-TW':traditionalMessages,vi:vietnameseMessages};
const patterns:Array<[RegExp,(m:RegExpMatchArray,language:Language)=>string]> = [
 [/^(\d+) 天前$/, (m,l)=>({zh:`${m[1]} 天前`,'zh-TW':`${m[1]} 天前`,en:`${m[1]} days ago`,vi:`${m[1]} ngày trước`})[l]],
 [/^(\d+) 条发现$/, (m,l)=>({zh:`${m[1]} 条发现`,'zh-TW':`${m[1]} 則發現`,en:`${m[1]} discoveries`,vi:`${m[1]} nội dung`})[l]],
 [/^(\d+) 个来源$/, (m,l)=>({zh:`${m[1]} 个来源`,'zh-TW':`${m[1]} 個來源`,en:`${m[1]} sources`,vi:`${m[1]} nguồn`})[l]],
 [/^已检查 (\d+) 个来源 · 还有 (\d+) 个$/, (m,l)=>({zh:`已检查 ${m[1]} 个来源 · 还有 ${m[2]} 个`,'zh-TW':`已檢查 ${m[1]} 個來源 · 還有 ${m[2]} 個`,en:`Checked ${m[1]} sources · ${m[2]} remaining`,vi:`Đã kiểm tra ${m[1]} nguồn · còn ${m[2]} nguồn`})[l]],
 [/^AI 正在整理阅读笔记 · 已完成 (\d+) 条$/, (m,l)=>({zh:`AI 正在整理阅读笔记 · 已完成 ${m[1]} 条`,'zh-TW':`AI 正在整理閱讀筆記 · 已完成 ${m[1]} 則`,en:`AI reading · ${m[1]} notes ready`,vi:`AI đang đọc · đã hoàn thành ${m[1]} ghi chú`})[l]],
 [/^已为 (\d+) 条内容整理 AI 阅读笔记。$/, (m,l)=>({zh:`已为 ${m[1]} 条内容整理 AI 阅读笔记。`,'zh-TW':`已為 ${m[1]} 則內容整理 AI 閱讀筆記。`,en:`AI notes are ready for ${m[1]} items.`,vi:`Đã tạo ghi chú AI cho ${m[1]} nội dung.`})[l]],
 [/^已屏蔽 (.+)，可在内容来源恢复。$/, (m,l)=>({zh:`已屏蔽 ${m[1]}，可在内容来源恢复。`,'zh-TW':`已封鎖 ${m[1]}，可在內容來源恢復。`,en:`Blocked ${m[1]}. Restore it in Sources.`,vi:`Đã chặn ${m[1]}. Bạn có thể khôi phục trong Nguồn.`})[l]],
 [/^观看 (.+)$/, (m,l)=>({zh:`观看 ${m[1]}`,'zh-TW':`觀看 ${m[1]}`,en:`Watch ${m[1]}`,vi:`Xem ${m[1]}`})[l]],
 [/^(?:已连接 (\d+) 个来源|(\d+) 个来源已连接)$/, (m,l)=>({zh:`已连接 ${m[1]||m[2]} 个来源`,'zh-TW':`已連接 ${m[1]||m[2]} 個來源`,en:`${m[1]||m[2]} sources connected`,vi:`Đã kết nối ${m[1]||m[2]} nguồn`})[l]],
 [/^上次更新 · (.+)$/, (m,l)=>({zh:`上次更新 · ${m[1]}`,'zh-TW':`上次更新 · ${m[1]}`,en:`Last updated · ${m[1]}`,vi:`Cập nhật lần cuối · ${m[1]}`})[l]],
 [/^依据来源 (\d+)$/, (m,l)=>({zh:`依据来源 ${m[1]}`,'zh-TW':`依據來源 ${m[1]}`,en:`Source ${m[1]}`,vi:`Nguồn ${m[1]}`})[l]],
 [/^已添加 (\d+) 个来源，跳过 (\d+) 个重复，(\d+) 个未完成。$/, (m,l)=>({zh:m[0],'zh-TW':`已新增 ${m[1]} 個來源，略過 ${m[2]} 個重複，${m[3]} 個未完成。`,en:`Added ${m[1]} sources, skipped ${m[2]} duplicates, ${m[3]} not added.`,vi:`Đã thêm ${m[1]} nguồn, bỏ qua ${m[2]} nguồn trùng lặp, ${m[3]} nguồn chưa được thêm.`})[l]],
 [/^另有 (\d+) 个未确认或尚未发送。$/, (m,l)=>({zh:m[0],'zh-TW':`另有 ${m[1]} 個未確認或尚未傳送。`,en:`${m[1]} remain unconfirmed or unsent.`,vi:`Còn ${m[1]} nguồn chưa xác nhận hoặc chưa gửi.`})[l]],
];
/** Translate interface copy only. Never pass original article text, user goals, or generated summaries here. */
export function translate(chinese:string,language:Language,english?:string):string {
 if(language==='zh')return chinese;
 if(language==='en'&&english)return english;
 const exact=interfaceMessages[language][chinese];if(exact)return exact;
 for(const [pattern,render] of patterns){const match=chinese.match(pattern);if(match)return render(match,language);}
 // Fixed, safe UI fallback for server errors. Upstream bodies are never surfaced as translated content.
 if(/[\u3400-\u9fff]/.test(chinese)&&/请|未能|失败|无效|错误|不存在|不可|不足|上限|暂时|不正确/.test(chinese))return interfaceMessages[language]['未能完成此操作，请检查设置后重试。'];
 // New optional extensions may supply English before adding a locale entry; preserve meaning until translated.
 return english||chinese;
}
