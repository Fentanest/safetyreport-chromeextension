import vm from 'node:vm';
import { createClient as realCreateClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { buildRequest, classifyError, retryAfterSeconds, projectCloudDto } from '../src/myReportsClient.js';
import { migrateFromSelfhost } from '../src/migration.js';
export const EXT = 'abcdefghijklmnopabcdefghijklmnop';
export const SUPA = 'https://test-project.supabase.co';
export const authKey = 'sb-test-project-auth-token';
export const session = id => ({ access_token: 'private-access', refresh_token: 'private-refresh', expires_at: Date.now()/1000+3600,
  user: { id, user_metadata: { full_name: '테스트 계정' } } });
const event = () => {const listeners=[];return { addListener(fn){listeners.push(fn);}, emit(...args){return listeners.map(fn=>fn(...args));} };};
// legacy: true gives the worker the 1.2.6 alarms/notifications APIs (as if their permissions were still granted);
// the default matches the 1.3.0 manifest, where those namespaces do not exist. granted lists extra optional grants.
export async function worker({ local = {}, sync = {}, fetchImpl, configured = true, auth = {}, realSdk = false, legacy = false,
  granted = { origins: [], permissions: [] }, failStorageRemove = null, failPermissionRemove = false,
  seedAlarms = [], seedNotices = [] } = {}) {
  const changed = event(), messages = event(), alarms = new Map(), badges = [], notices = new Map(), calls = [], removedPermissions = [];
  const grants = structuredClone(granted);
  const stores = { local: structuredClone(local), sync: structuredClone(sync), session: {} };
  const makeStore = area => ({
    async get(key){const data=stores[area];return key==null?structuredClone(data):Object.fromEntries((Array.isArray(key)?key:[key]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));},
    async set(values){const changes={};for(const [key,value]of Object.entries(values)){if(JSON.stringify(stores[area][key])!==JSON.stringify(value))changes[key]={oldValue:stores[area][key],newValue:structuredClone(value)};stores[area][key]=structuredClone(value);}changed.emit(changes,area);},
    async remove(keys){if(failStorageRemove?.(area,keys))throw new Error('storage failure');const changes={};for(const key of Array.isArray(keys)?keys:[keys]){if(key in stores[area])changes[key]={oldValue:stores[area][key],newValue:undefined};delete stores[area][key];}changed.emit(changes,area);},
    async setAccessLevel(value){calls.push({accessLevel:value});},
    async clear(){calls.push({cleared:area});throw new Error('CLEAR_FORBIDDEN');},
  });
  const network = async (url,options) => {calls.push({url,options});return fetchImpl ? fetchImpl(url,options) : new Response('{}');};
  const chrome = {
    storage:{local:makeStore('local'),sync:makeStore('sync'),session:makeStore('session'),onChanged:changed},
    runtime:{id:EXT,getURL:p=>`chrome-extension://${EXT}/${p}`,getManifest:()=>({...JSON.parse(readFileSync('manifest.json','utf8')),host_permissions:[`${SUPA}/*`]}),onMessage:messages,onInstalled:event(),onStartup:event(),sendMessage:async()=>{}},
    permissions:{async getAll(){return {permissions:['storage','identity','clipboardWrite',...grants.permissions],
      origins:[`${SUPA}/*`,'https://www.safetyreport.go.kr/*',...grants.origins]};},
      async remove(value){removedPermissions.push(value);if(failPermissionRemove)throw new Error('permission failure');grants.origins=grants.origins.filter(o=>!(value.origins||[]).includes(o));
        grants.permissions=grants.permissions.filter(p=>!(value.permissions||[]).includes(p));return true;}},
    action:{async setBadgeText(value){badges.push(value.text);},async setBadgeBackgroundColor(){}},
    tabs:{query:async()=>[],sendMessage:async()=>{}},identity:{getRedirectURL:()=>`https://${EXT}.chromiumapp.org/supabase-auth`},
  };
  if (legacy) {
    for (const name of seedAlarms) alarms.set(name, { periodInMinutes: 5 });
    for (const id of seedNotices) notices.set(id, { type: 'basic' });
    chrome.alarms={async get(name){return alarms.get(name);},async clear(name){alarms.delete(name);},async create(name,options){alarms.set(name,options);},onAlarm:event()};
    chrome.notifications={async getAll(){return Object.fromEntries(notices);},async clear(id){notices.delete(id);},async create(id,value){notices.set(id,value);}};
  }
  const createClient = () => ({auth:{
    async getSession(){calls.push({auth:'getSession'});const value=stores.local[authKey];return {data:{session: typeof value==='string'?JSON.parse(value):value || null}};},
    async refreshSession(){calls.push({auth:'refreshSession'});return auth.refreshSession?auth.refreshSession():{data:{session:session('a')}};},
    async signOut(){calls.push({auth:'signOut'});await chrome.storage.local.remove(authKey);return {};},...auth,
  }});
  const code = readFileSync('src/background.js','utf8').replace(/^import .*;\n/gm,'');
  const context = vm.createContext({chrome,createClient:realSdk?realCreateClient:createClient,buildRequest,classifyError,retryAfterSeconds,projectCloudDto,
    migrateFromSelfhost,
    __SUPABASE_URL__:configured?SUPA:'',__SUPABASE_KEY__:configured?'sb_publishable_public':'',
    fetch:network,AbortController,URL,Map,Set,TextEncoder,crypto:webcrypto,setTimeout,clearTimeout,console});
  vm.runInContext(code,context);
  await vm.runInContext('ready',context);
  async function send(message,role='trusted',senderOverrides={}){
    const sender={id:EXT,url:role==='trusted'?chrome.runtime.getURL('options.html'):'https://www.safetyreport.go.kr/',frameId:0,...senderOverrides};
    return new Promise((resolve,reject)=>{
      const accepted=messages.emit(message,sender,response=>response.error?reject(new Error(response.error)):resolve(response.data));
      if(!accepted.includes(true))reject(new Error('MESSAGE_REJECTED'));
    });
  }
  return {send,chrome,stores,calls,alarms,badges,notices,context,grants,removedPermissions};
}
