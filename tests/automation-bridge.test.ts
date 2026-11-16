import {describe,expect,it,vi} from 'vitest';
import type {CircuitStudioApi} from '../src/automation';
import {BRIDGE_PROTOCOL,bridgeConfig,connectBridge,createBridgeHandler} from '../src/bridge';

const api=(overrides:Partial<CircuitStudioApi>={}):CircuitStudioApi=>({version:1,ready:Promise.resolve(),
 openProject:vi.fn(async()=>({name:'Demo',components:2,wires:1})),getProject:vi.fn(()=>({name:'Demo'}) as never),
 listParts:vi.fn(async()=>[]),capabilities:vi.fn(async()=>({mp4:true,webm:false,png:true})),
 renderImage:vi.fn(async()=>new Blob([new Uint8Array([1,2,3])],{type:'image/png'})),
 renderVideo:vi.fn(async()=>({blob:new Blob(['mp4'],{type:'video/mp4'}),filename:'a.mp4',mimeType:'video/mp4',frames:1,duration:1,warnings:[]})),
 planRoutes:vi.fn(async()=>({blocked:[],wires:[]})),...overrides});

const run=async(target:CircuitStudioApi,request:object)=>{const sent:object[]=[];await createBridgeHandler(target,m=>sent.push(m))(request as never);return sent};

class FakeSocket{static OPEN=1;readyState=0;sent:string[]=[];onopen?:()=>void;onmessage?:(e:{data:string})=>void;onclose?:(e:{code:number})=>void;
 constructor(public url:string){}
 send(text:string){this.sent.push(text)}close(code=1006){this.readyState=3;this.onclose?.({code})}
 opened(){this.readyState=1;this.onopen?.()}}

describe('automation bridge',()=>{
 it('reads its settings from the URL fragment, towards this machine only',()=>{
  expect(bridgeConfig('#bridge=ws://127.0.0.1:5199&token=abc')).toEqual({url:'ws://127.0.0.1:5199/',token:'abc'});
  expect(bridgeConfig('#bridge=ws://localhost:5199/kit&token=abc')?.url).toBe('ws://localhost:5199/kit');
  expect(bridgeConfig('#bridge=ws://[::1]:5199&token=abc')).toBeDefined();
  for(const hash of ['','#bridge=ws://127.0.0.1:5199','#token=abc','#bridge=ws://example.com:5199&token=abc',
   '#bridge=wss://evil.example&token=abc','#bridge=http://127.0.0.1:5199&token=abc','#bridge=not a url&token=abc'])expect(bridgeConfig(hash)).toBeUndefined();
 });
 it('runs a request on the API and answers with its result',async()=>{
  const target=api();
  expect(await run(target,{id:1,method:'openProject',params:['{"name":"Demo"}']})).toEqual([{id:1,result:{name:'Demo',components:2,wires:1}}]);
  expect(target.openProject).toHaveBeenCalledWith('{"name":"Demo"}');
  expect(await run(target,{id:2,method:'ready'})).toEqual([{id:2,result:undefined}]);
 });
 it('sends blobs as base64',async()=>{
  expect(await run(api(),{id:3,method:'renderImage'})).toEqual([{id:3,result:{$blob:{type:'image/png',base64:'AQID'}}}]);
 });
 it('reports errors and unknown methods',async()=>{
  expect(await run(api({openProject:async()=>{throw new Error('Invalid project')}}),{id:4,method:'openProject',params:[{}]})).toEqual([{id:4,error:{message:'Invalid project'}}]);
  expect(await run(api(),{id:5,method:'constructor'})).toEqual([{id:5,error:{message:'Unknown method: constructor'}}]);
 });
 it('streams render progress and can cancel a render',async()=>{
  let signal:AbortSignal|undefined;
  const target=api({renderVideo:async(_settings,options={})=>{signal=options.signal;options.onProgress?.({phase:'render',progress:.5} as never);
   await new Promise<void>((_,reject)=>options.signal!.addEventListener('abort',()=>reject(new Error('Export cancelled'))));throw new Error('unreachable')}});
  const sent:object[]=[],handle=createBridgeHandler(target,m=>sent.push(m));
  const rendering=handle({id:6,method:'renderVideo',params:[{fps:30}]});
  await Promise.resolve();
  await handle({cancel:6});
  await rendering;
  expect(signal?.aborted).toBe(true);
  expect(sent).toEqual([{id:6,progress:{phase:'render',progress:.5}},{id:6,error:{message:'Export cancelled'}}]);
 });
 it('introduces itself with the token, and reconnects after a drop',()=>{
  vi.useFakeTimers();vi.stubGlobal('WebSocket',FakeSocket);
  const sockets:FakeSocket[]=[],states:string[]=[];
  let client='';
  const stop=connectBridge({url:'ws://127.0.0.1:5199/',token:'abc'},api(),{retry:1000,onState:s=>states.push(s),onWelcome:name=>{client=name},open:url=>{const s=new FakeSocket(url);sockets.push(s);return s as never}});
  sockets[0].opened();
  sockets[0].onmessage?.({data:JSON.stringify({type:'welcome',client:'Circuit Studio agent kit'})});
  expect(client).toBe('Circuit Studio agent kit');
  expect(sockets[0].sent).toHaveLength(1);
  expect(JSON.parse(sockets[0].sent[0])).toEqual({type:'hello',token:'abc',protocol:BRIDGE_PROTOCOL,api:1});
  sockets[0].close();
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(2);
  expect(states).toEqual(['connecting','connected','disconnected','connecting']);
  sockets[1].opened();sockets[1].close(4000);vi.advanceTimersByTime(5000);
  expect(sockets).toHaveLength(2);
  expect(states.slice(4)).toEqual(['connected','replaced']);
  stop();
  vi.useRealTimers();vi.unstubAllGlobals();
 });
});
