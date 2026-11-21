import type {Language} from './language';
export const signupMessages = {
 zh: {full:'名额已满，请发邮件到 alan.xiaofei224@gmail.com 申请开通。',apply:'邮件申请开通',subject:'申请开通 YourFeed 账户',body:'姓名：\n邮箱：{email}\n申请理由：',intro:'使用自己的邮箱注册或登录，每个人都有独立的信息流。',privacy:'开放注册 · 个人信息流与密钥独立保存'},
 'zh-TW': {full:'名額已滿，請寄信至 alan.xiaofei224@gmail.com 申請開通。',apply:'寄信申請開通',subject:'申請開通 YourFeed 帳戶',body:'姓名：\n信箱：{email}\n申請理由：',intro:'使用自己的信箱註冊或登入，每個人都有獨立的資訊流。',privacy:'開放註冊 · 個人資訊流與金鑰獨立儲存'},
 en: {full:'All account slots are full. Email alan.xiaofei224@gmail.com to request access.',apply:'Request access by email',subject:'Request a YourFeed account',body:'Name:\nEmail: {email}\nReason for requesting access:',intro:'Sign up or sign in with your own email. Each person has an independent feed.',privacy:'Open registration · Separate personal feeds and keys'},
 vi: {full:'Đã hết chỗ. Hãy gửi email đến alan.xiaofei224@gmail.com để yêu cầu mở tài khoản.',apply:'Yêu cầu qua email',subject:'Yêu cầu mở tài khoản YourFeed',body:'Họ tên:\nEmail: {email}\nLý do yêu cầu:',intro:'Đăng ký hoặc đăng nhập bằng email của bạn. Mỗi người có bảng tin riêng.',privacy:'Đăng ký mở · Bảng tin và khóa cá nhân được lưu riêng'},
} satisfies Record<Language,Record<string,string>>;
export function signupMailto(email:string,language:Language):string {
 const message=signupMessages[language];
 return 'mailto:alan.xiaofei224@gmail.com?subject='+encodeURIComponent(message.subject)+'&body='+encodeURIComponent(message.body.replace('{email}',email.trim().replace(/[\r\n]/g,'')));
}
