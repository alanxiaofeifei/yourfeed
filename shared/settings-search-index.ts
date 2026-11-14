import type {Language} from './language';
export type SettingsTab='profile'|'ai'|'storage'|'domain';
export type SettingStatus='loading'|'unavailable'|'notConfigured'|'saved'|'unsaved';
export function settingStatus(loaded:boolean|undefined,configured:boolean,dirty=false):SettingStatus{
 if(loaded===undefined)return 'loading';if(!loaded)return 'unavailable';return dirty?'unsaved':configured?'saved':'notConfigured';
}
const item=(tab:SettingsTab,id:string,zh:string,en:string,tw:string,vi:string)=>({tab,id,labels:{zh,en,'zh-TW':tw,vi}});
/** Static labels only. No runtime values, identity, reading data or credentials enter the index. */
export const settingsSearchIndex=[
 item('profile','profile-name','显示名称 姓名','Display name','顯示名稱 姓名','Tên hiển thị'),
 item('profile','profile-goals','目标 兴趣 偏好','Goals interests profile','目標 興趣 偏好','Mục tiêu sở thích tùy chọn'),
 item('profile','profile-ui-language','界面语言','Interface language','介面語言','Ngôn ngữ giao diện'),
 item('profile','profile-timezone','时区','Time zone timezone','時區','Múi giờ'),
 item('ai','ai-model','AI 模型 服务商','AI model provider','AI 模型 服務商','Mô hình AI nhà cung cấp'),
 item('ai','ai-key','AI 密钥 API Key','AI API key','AI 金鑰 API Key','Khóa API AI'),
 item('ai','monthly-budget','预算 费用 上限','Budget cost limit','預算 費用 上限','Ngân sách chi phí giới hạn'),
 item('ai','temperature','温度','Temperature','溫度','Nhiệt độ'),
 item('ai','ai-advanced','高级参数 协议 自定义费率 价格','Advanced parameters protocol custom pricing rates','進階參數 協定 自訂費率 價格','Tham số nâng cao giao thức giá tùy chỉnh'),
 item('ai','max-output','最大输出 tokens','Maximum output tokens','最大輸出 tokens','Token đầu ra tối đa'),
 item('ai','timeout-seconds','请求超时','Request timeout','請求逾時','Thời gian chờ yêu cầu'),
 item('ai','reasoning-effort','推理强度','Reasoning effort','推理強度','Mức suy luận'),
 item('ai','response-format','结构化输出 JSON','Structured output JSON','結構化輸出 JSON','Đầu ra có cấu trúc JSON'),
 item('ai','daily-limit','每日分析数量','Daily analysis limit','每日分析數量','Giới hạn phân tích mỗi ngày'),
 item('profile','profile-summary-language','AI 摘要语言','AI summary language','AI 摘要語言','Ngôn ngữ tóm tắt AI'),
 item('ai','youtube-key','YouTube 密钥 频道','YouTube key channels','YouTube 金鑰 頻道','Khóa YouTube kênh'),
 item('storage','storage-summary','缓存 存储 归档 备份','Cache storage archive backup','快取 儲存 歸檔 備份','Bộ nhớ đệm lưu trữ sao lưu'),
 item('storage','storage-device','设备缓存','Device cache','裝置快取','Đệm thiết bị'),
 item('storage','storage-retention','正文保留 到期提醒','Text retention expiry reminders','內文保留 到期提醒','Lưu giữ văn bản nhắc hết hạn'),
 item('storage','storage-archive','下载归档 恢复 导出','Download archive restore export','下載歸檔 復原 匯出','Tải tệp lưu trữ khôi phục xuất'),
 item('domain','deployment-hostname','域名 部署 地址','Domain deployment hostname','網域 部署 位址','Tên miền triển khai địa chỉ'),
];
export function searchSettings(query:string,language:Language){
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return terms.length?settingsSearchIndex.filter(item=>{
  const text=Object.values(item.labels).join(' ').toLocaleLowerCase();
  const words=text.split(/[^\p{L}\p{N}]+/u);
  return terms.every(term=>/^[a-z0-9]+$/.test(term)?words.some(word=>word.startsWith(term)):text.includes(term));
 }).map(item=>({...item,label:item.labels[language]})):[];
}
