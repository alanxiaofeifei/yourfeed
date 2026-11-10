'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Globe2, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { DeploymentState } from '../../server/deployment';
import { localeTag, useI18n } from '../i18n';
import './DeploymentSettings.css';

export default function DeploymentSettings() {
 const {t,language}=useI18n();
 const [state,setState]=useState<DeploymentState|null>(null),[hostname,setHostname]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 async function call(path:string,method='GET',body?:unknown) {
  const response=await fetch(path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const value=await response.json() as DeploymentState & {error?:string};if(!response.ok)throw new Error(value.error||t('操作未完成，请重试。','The action could not complete. Try again.'));
  return value as DeploymentState;
 }
 useEffect(()=>{let mounted=true;call('/api/deployment').then(value=>{if(mounted){setState(value);setHostname(value.hostname);}}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[]);
 async function perform(action:'save'|'check') {
  setBusy(action);setError('');setSaved(false);
  try {const value=await call(action==='save'?'/api/deployment':'/api/deployment/check',action==='save'?'PUT':'POST',action==='save'?{hostname}:{});setState(value);setHostname(value.hostname);setSaved(action==='save');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');}
 }
 const sameSaved=hostname.trim()===state?.hostname;
 return <section className="deployment-settings">
  <div className="deployment-intro"><span className="deployment-icon"><Globe2 size={25}/></span><div><h3>{t('给你的空间一个地址','An address for your space')}</h3><p>{t('先在托管平台绑定域名，再回到这里检查。','Connect a domain with your hosting provider, then check it here.')}</p></div></div>
  <div className="deployment-current"><span>{t('当前地址','Current address')}</span><code>{state?.currentOrigin||'—'}</code><span className="deployment-chip">{state?.hostingMode==='sites'?'ChatGPT Sites':'Cloudflare Workers'}</span></div>
  <ol className="deployment-steps">
   <li><b>1</b><div><h4>{t('准备一个域名','Prepare a domain')}</h4><p>{t('独立部署需要把域名所在区域接入你的 Cloudflare 账户，并拥有编辑 Worker 与域名路由的权限。','For a standalone deployment, the domain must be an active zone in your Cloudflare account. You need permission to edit the Worker and domain routes.')}</p></div></li>
   <li><b>2</b><div><h4>{t('在平台绑定','Connect with your provider')}</h4><p>{state?.hostingMode==='sites'?t('Sites 的域名与访问权限由 ChatGPT 中的 Sites 工具管理。此页面无法代替管理工具，也不会更改私人站点的访问权限。','Manage Sites domains and access through the Sites tools in ChatGPT. This page cannot replace those tools or change private-site access.'):t('打开 Workers → 你的 Worker → 设置 → 域和路由 → 添加 → 自定义域。Cloudflare 会创建 DNS 记录并签发证书。','Open Workers → your Worker → Settings → Domains & Routes → Add → Custom Domain. Cloudflare creates the DNS record and provisions the certificate.')}</p><a href={state?.hostingMode==='sites'?'https://learn.chatgpt.com/docs/sites/managing-a-site':'https://dash.cloudflare.com/'} target="_blank" rel="noreferrer">{t('打开平台','Open provider')}<ExternalLink size={13}/></a></div></li>
   <li><b>3</b><div><h4>{t('保存并检查','Save and verify')}</h4><p>{t('检查公开 DNS、HTTPS 和是否到达当前实例。网站不会索要或保存 Cloudflare 管理令牌。','Check public DNS, HTTPS, and whether the domain reaches this instance. YourFeed never asks for or stores a Cloudflare management token.')}</p></div></li>
  </ol>
  <form className="deployment-form" onSubmit={event=>{event.preventDefault();void perform('save');}}>
   <label htmlFor="deployment-hostname">{t('目标域名','Target hostname')}</label>
   <div className="deployment-input-row"><input id="deployment-hostname" value={hostname} onChange={event=>{setHostname(event.target.value);setSaved(false);}} placeholder="feed.example.com" autoComplete="off" spellCheck={false}/><button type="submit" disabled={!!busy||!state}>{busy==='save'?<LoaderCircle size={16} className="spin"/>:null}{t('保存','Save')}</button><button type="button" className="deployment-check" disabled={!!busy||!state?.hostname||!sameSaved} onClick={()=>void perform('check')}>{busy==='check'?<LoaderCircle size={16} className="spin"/>:<ShieldCheck size={16}/>} {t('检查连接','Check connection')}</button></div>
  </form>
  {saved&&<p className="deployment-success" role="status">{t('已保存。现在可以检查域名连接。','Saved. You can now check the domain connection.')}</p>}
  {error&&<p className="deployment-error" role="alert">{error}</p>}
  {state?.lastCheck&&<div className={'deployment-result '+(state.lastCheck.instance==='matched'?'verified':'')} role="status"><div className="deployment-result-title"><CheckCircle2 size={18}/><strong>{state.lastCheck.instance==='matched'?t('已到达当前实例','This instance verified'):t('连接尚未验证','Connection not verified')}</strong><time>{new Date(state.lastCheck.checkedAt).toLocaleString(localeTag(language))}</time></div><div className="deployment-statuses"><span>DNS: {state.lastCheck.dns}</span><span>HTTPS: {state.lastCheck.https}</span><span>{t('实例','Instance')}: {state.lastCheck.instance}</span></div><p>{state.lastCheck.instance==='matched'?t('域名已指向当前 YourFeed。登录主地址仍保持原配置。','The domain reaches this YourFeed. Your configured sign-in origin remains unchanged.'):state.lastCheck.https==='authentication-required'?t('域名有响应，但登录页或重定向阻止了验证。请检查平台的域名和访问设置。','The domain responded, but a sign-in page or redirect prevented verification. Check the provider’s domain and access settings.'):t('请检查 DNS 传播、证书和 Worker 路由，然后重试。','Check DNS propagation, the certificate and Worker routing, then try again.')}</p></div>}
  <div className="deployment-note"><ShieldCheck size={17}/><p>{t('域名检查不会切换登录主地址。需要迁移登录地址时，先在部署环境更新 AUTH_BASE_URL 与 OAuth 回调地址，保留原地址直到新域名登录验证成功。','Verification never switches the sign-in origin. To migrate, update AUTH_BASE_URL and OAuth callback URLs in the deployment environment, keeping the old address until sign-in works on the new domain.')}{state?.configuredOrigin&&<> {t('当前配置：','Configured: ')}<code>{state.configuredOrigin}</code></>}</p></div>
 </section>;
}
