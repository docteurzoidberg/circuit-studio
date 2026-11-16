// Opt-in bridge that lets a local automation client (a command line or a tool server on this machine) drive the
// automation API from outside the browser, over a WebSocket (docs/AUTOMATION_API.md#bridge). The page connects to
// the client, not the other way round, so no browser needs to be launched or driven: the visitor only opens a link.
// Enabled only by the URL fragment `#bridge=ws://127.0.0.1:<port>&token=<token>` (the fragment never reaches a
// server), and only towards this machine (loopback addresses).
import {create} from 'zustand';
import type {CircuitStudioApi} from './automation';

export type BridgeConfig={url:string;token:string};
export type BridgeState='connecting'|'connected'|'disconnected'|'replaced'|'rejected';
/** Close codes from the client: another page took over, or this page's token was refused. No reconnection then. */
export const CLOSE_REPLACED=4000,CLOSE_REJECTED=4001;
type Request={id:number;method:string;params?:unknown[]}|{cancel:number};
type Send=(message:object)=>void;

/** What the header shows: whether a tool drives this page, and its name (sent by the tool once it accepts the page). */
export const useBridgeStatus=create<{state?:BridgeState;client?:string;address?:string;disconnect?:()=>void}>(()=>({}));

const LOOPBACK=new Set(['127.0.0.1','localhost','[::1]']);
const METHODS=['ready','openProject','getProject','listParts','capabilities','renderImage','renderVideo','planRoutes','videoSettings'] as const;
/** Sent in the page's hello; also lets a tool recognise a build that has the bridge. */
export const BRIDGE_PROTOCOL='circuit-studio-bridge/1';

/** The bridge settings in a URL fragment, or nothing when absent or not towards this machine. */
export function bridgeConfig(hash:string):BridgeConfig|undefined{
 const params=new URLSearchParams(hash.replace(/^#/,'')),url=params.get('bridge'),token=params.get('token');
 if(!url||!token)return;
 let parsed:URL;try{parsed=new URL(url)}catch{return}
 return parsed.protocol==='ws:'&&LOOPBACK.has(parsed.hostname)?{url:parsed.href,token}:undefined;
}

async function base64(blob:Blob){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
/** Results go over JSON: a Blob becomes `{$blob: {type, base64}}`. */
async function serialize(value:unknown):Promise<unknown>{
 if(value instanceof Blob)return {$blob:{type:value.type,base64:await base64(value)}};
 if(Array.isArray(value))return Promise.all(value.map(serialize));
 if(value&&typeof value==='object'){const entries=await Promise.all(Object.entries(value).map(async([k,v])=>[k,await serialize(v)] as const));return Object.fromEntries(entries)}
 return value;
}

/** Runs the client's requests on the API; answers `{id, result}`, `{id, error}` or, while rendering, `{id, progress}`. */
export function createBridgeHandler(api:CircuitStudioApi,send:Send){
 const running=new Map<number,AbortController>();
 return async(request:Request)=>{
  if('cancel' in request){running.get(request.cancel)?.abort();return}
  const {id,method,params=[]}=request;
  try{
   if(!(METHODS as readonly string[]).includes(method))throw new Error(`Unknown method: ${method}`);
   let result:unknown;
   if(method==='ready')result=await api.ready;
   else if(method==='renderVideo'){
    const controller=new AbortController();running.set(id,controller);
    const [settings,options={}]=params as Parameters<CircuitStudioApi['renderVideo']>;
    result=await api.renderVideo(settings,{...options,signal:controller.signal,onProgress:progress=>send({id,progress})});
   }else result=await (api[method as Exclude<typeof METHODS[number],'ready'|'renderVideo'>] as (...args:unknown[])=>unknown)(...params);
   send({id,result:await serialize(result)});
  }catch(error){send({id,error:{message:error instanceof Error?error.message:String(error)}})}
  finally{running.delete(id)}
 };
}

/** Connects to the client, introduces itself with the token, and reconnects every `retry` ms after a drop. */
export function connectBridge(config:BridgeConfig,api:CircuitStudioApi,{retry=2000,onState=(_:BridgeState)=>{},onWelcome=(_:string)=>{},open=(url:string)=>new WebSocket(url)}:{retry?:number;onState?:(state:BridgeState)=>void;onWelcome?:(client:string)=>void;open?:(url:string)=>WebSocket}={}){
 let socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
 const connect=()=>{
  onState('connecting');
  const current=open(config.url);socket=current;
  const send:Send=message=>{if(current.readyState===WebSocket.OPEN)current.send(JSON.stringify(message))};
  const handle=createBridgeHandler(api,send);
  current.onopen=()=>{send({type:'hello',token:config.token,protocol:BRIDGE_PROTOCOL,api:api.version});onState('connected')};
  current.onmessage=event=>{let message:Request|{type:'welcome';client?:string};try{message=JSON.parse(String(event.data))}catch{return}
   if('type' in message){if(message.type==='welcome'&&typeof message.client==='string')onWelcome(message.client.slice(0,60));return}
   void handle(message)};
  current.onclose=event=>{const final=event.code===CLOSE_REPLACED?'replaced':event.code===CLOSE_REJECTED?'rejected':undefined;onState(final??'disconnected');if(!stopped&&!final)timer=setTimeout(connect,retry)};
 };
 connect();
 return ()=>{stopped=true;if(timer)clearTimeout(timer);socket?.close()};
}

/** Starts the bridge when the page's URL asks for it; the header shows its state and lets the visitor cut it (BridgeBadge). */
export function startBridge(api:CircuitStudioApi|undefined=window.circuitStudio){
 const config=bridgeConfig(window.location.hash);
 if(!config||!api)return;
 const stop=connectBridge(config,api,{onState:state=>useBridgeStatus.setState({state}),onWelcome:client=>useBridgeStatus.setState({client})});
 // Disconnecting also drops the link from the address bar, so reloading the page does not reconnect.
 const disconnect=()=>{stop();history.replaceState(null,'',window.location.pathname+window.location.search);useBridgeStatus.setState({state:undefined,client:undefined,address:undefined,disconnect:undefined})};
 useBridgeStatus.setState({address:new URL(config.url).host,disconnect});
 return disconnect;
}
