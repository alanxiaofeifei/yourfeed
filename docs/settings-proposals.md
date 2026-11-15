# 设置体验 / Settings experience

[Issue #15](https://github.com/alanxiaofeifei/yourfeed/issues/15) · [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)。本地实现；不代表已发布或线上验收。七项均不改变数据库、登录、隔离、权限或保留策略。

## 简体中文

| 项目 | 你会看到什么 | 状态 |
| --- | --- | --- |
| 1. 分类状态 | 四个分类显示未配置、已保存或有未保存更改；读取失败会显示状态暂不可用。已保存不表示测试通过。 | 已实现 |
| 2. 保存与离页提示 | 偏好和 AI 的保存按钮使用相同状态，未修改时不能重复保存；切换前会确认，草稿在本次页面保留。关闭或刷新会提示，密钥草稿仅在内存中。 | 已实现 |
| 3. AI 简单与高级设置 | 默认免费公共通道无需密钥；自带连接先显示服务商、模型、密钥、测试与保存，高级参数可展开。填写错误会展开并定位。 | 已实现 |
| 4. 费用与测试说明 | 说明卡区分本站估算、上游账单和免费配额；自带密钥费用由你承担。测试只检查当前草稿，改动后旧结果失效，不会自动测试、保存或开启阅读。 | 已实现 |
| 5. 来源与接口互相引路 | 缺少 YouTube Key 时可从频道编辑或推荐去配置，再返回保留草稿；接口页也可前往频道。保存密钥后还需订阅和更新，RSS 不需要密钥。 | 已实现 |
| 6. 缓存与归档摘要 | 对照说明设备缓存、服务器正文与下载归档的内容、限制和恢复方式；缓存不是备份。下载失败可重试，不会显示未经确认的已备份状态。 | 已实现 |
| 7. 查找设置 | 输入预算、时区、YouTube 或缓存等关键词，可跳到对应分类并聚焦选项。只查静态界面标签，不搜索个人数据或密钥；跳转前同样确认未保存更改。 | 已实现 |

## English

| Item | What you will see | Status |
| --- | --- | --- |
| 1. Category status | Each category shows not configured, saved, or unsaved changes; failed reads show status unavailable. Saved does not mean tested. | Implemented |
| 2. Save and leave prompts | Profile and AI forms share save states and prevent unchanged or duplicate saves; navigation asks first and keeps drafts for this page session. Closing or reloading warns you, and key drafts stay in memory. | Implemented |
| 3. Basic and advanced AI | The default free public channel needs no key; your own connection starts with provider, model, key, test, and save, with advanced parameters tucked away. Invalid advanced fields expand and receive focus. | Implemented |
| 4. Cost and test explanation | A card separates site estimates, provider bills, and free quotas; you pay for your own key. Tests apply only to the draft, become stale after edits, and do not automatically run, save, or enable reading. | Implemented |
| 5. Sources and API links | A YouTube channel without a key links to setup and back with its draft intact; API settings also link to channels. Saving a key still requires subscribing and updating, while RSS needs no key. | Implemented |
| 6. Cache and archive summary | Compare device cache, server text, and downloaded archives, including their contents, limits, and recovery options; cache is not a backup. Failed downloads can be retried without an unverified “backed up” claim. | Implemented |
| 7. Find settings | Search budget, time zone, YouTube, or cache to jump to a category and focus its control. Only static interface labels are searched, with unsaved-change confirmation before navigation. | Implemented |

## 繁體中文（台灣）

| 項目 | 你會看到什麼 | 狀態 |
| --- | --- | --- |
| 1. 分類狀態 | 四個分類顯示未設定、已儲存或有未儲存變更；讀取失敗會明確提示。已儲存不代表測試通過。 | 已實作 |
| 2. 儲存與離頁提示 | 偏好與 AI 使用相同儲存狀態，未修改時不能重複儲存；切換前會確認，草稿留在本次頁面。關閉或重新整理會提示，金鑰草稿僅在記憶體。 | 已實作 |
| 3. AI 基本與進階設定 | 預設免費公開通道不需金鑰；自備連線先顯示服務商、模型、金鑰、測試與儲存，進階參數可展開。填寫錯誤時會展開並聚焦。 | 已實作 |
| 4. 費用與測試說明 | 說明卡區分本站估算、上游帳單與免費額度；自備金鑰費用由你負擔。測試只適用本次草稿，修改後舊結果失效，不會自動測試、儲存或開啟閱讀。 | 已實作 |
| 5. 來源與介面互相引導 | 缺少 YouTube Key 時可從頻道編輯或推薦前往設定，再返回保留草稿；介面頁也可前往頻道。儲存金鑰後仍需訂閱及更新，RSS 不需金鑰。 | 已實作 |
| 6. 快取與歸檔摘要 | 比較裝置快取、伺服器內文與下載歸檔的內容、限制及復原方式；快取不是備份。下載失敗可重試，不會顯示未確認的已備份狀態。 | 已實作 |
| 7. 尋找設定 | 輸入預算、時區、YouTube 或快取，可跳到分類並聚焦選項。只查靜態介面標籤，不搜尋個人資料或金鑰；跳轉前同樣確認未儲存變更。 | 已實作 |

## Tiếng Việt

| Mục | Bạn sẽ thấy gì | Trạng thái |
| --- | --- | --- |
| 1. Trạng thái danh mục | Mỗi danh mục hiển thị chưa cấu hình, đã lưu hoặc có thay đổi chưa lưu; lỗi đọc được báo rõ. Đã lưu không có nghĩa đã kiểm tra. | Đã thực hiện |
| 2. Lưu và cảnh báo rời trang | Tùy chọn và AI dùng chung trạng thái lưu, ngăn lưu lặp hoặc khi chưa sửa; chuyển trang hỏi trước và giữ bản nháp trong phiên trang này. Đóng hoặc tải lại sẽ cảnh báo, bản nháp khóa chỉ nằm trong bộ nhớ. | Đã thực hiện |
| 3. AI cơ bản và nâng cao | Kênh công khai miễn phí mặc định không cần khóa; kết nối riêng hiển thị nhà cung cấp, mô hình, khóa, kiểm tra và lưu trước, với tham số nâng cao có thể mở. Trường sai sẽ được mở và lấy tiêu điểm. | Đã thực hiện |
| 4. Giải thích phí và kiểm tra | Thẻ phân biệt ước tính của trang, hóa đơn nhà cung cấp và hạn mức miễn phí; bạn chịu phí cho khóa riêng. Kiểm tra chỉ áp dụng cho bản nháp, hết hiệu lực sau khi sửa và không tự chạy, lưu hay bật đọc. | Đã thực hiện |
| 5. Liên kết nguồn và API | Kênh YouTube thiếu khóa có nút đến cấu hình rồi quay lại giữ bản nháp; trang API cũng dẫn đến kênh. Lưu khóa vẫn cần đăng ký và cập nhật nguồn, còn RSS không cần khóa. | Đã thực hiện |
| 6. Tóm tắt đệm và lưu trữ | So sánh đệm thiết bị, văn bản máy chủ và tệp tải xuống về nội dung, giới hạn và khôi phục; đệm không phải sao lưu. Có thể thử lại tải lỗi và không báo đã sao lưu khi chưa xác nhận. | Đã thực hiện |
| 7. Tìm cài đặt | Tìm ngân sách, múi giờ, YouTube hoặc bộ nhớ đệm để đến đúng danh mục và lấy tiêu điểm. Chỉ tìm nhãn giao diện tĩnh, không tìm dữ liệu riêng hay khóa; chuyển mục vẫn hỏi về thay đổi chưa lưu. | Đã thực hiện |

账户身份与退出仅在右上角「我的账户」；侧栏仅说明阅读数据与导出文件隐私。无端到端加密或管理员无法访问的承诺。浏览器草稿不跨刷新恢复；归档仅包含现有数据，不是完整 D1 备份。

参考：[当前状态](STATUS.md)、[知识导出](knowledge.md)、[来源指南](sources.md)、[部署与身份](deployment.md)。
